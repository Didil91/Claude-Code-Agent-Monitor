/**
 * @file Machine metrics sensor for the "Machine" mode: samples the host PC's CPU, RAM,
 * disk activity, system-volume usage, NVIDIA GPU and top processes, keeps a 5-minute
 * in-memory rolling window, and broadcasts every sample over the dashboard WebSocket
 * (`machine.sample`). On Windows a single long-lived PowerShell process loops over the
 * language-independent `Win32_PerfFormattedData_*` CIM classes and prints one JSON line
 * per reading; `nvidia-smi -l` runs as a second long-lived process. Both are supervised
 * (restart with 2 s → 60 s exponential backoff) and killed on shutdown. Elsewhere it
 * degrades to Node-only CPU (os.cpus() deltas), RAM and disk space. Nothing is persisted.
 */

const os = require("os");
const fs = require("fs");
const childProcess = require("child_process");

const SYS_INTERVAL_MS = 2_000;
const PROC_INTERVAL_MS = 5_000;
const VOLUME_INTERVAL_MS = 30_000;
const WINDOW_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
// Processes kept per snapshot: union of the top N by CPU and the top N by memory.
const PROCESS_LIMIT = 20;
// A reading older than this many sensor intervals is treated as missing.
const STALE_FACTOR = 3;

// ── Pure helpers (exported for tests) ───────────────────────────────────────

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(value) {
  const n = toNumber(value);
  if (n === null) return null;
  return Math.min(100, Math.max(0, n));
}

function round1(n) {
  return n === null ? null : Math.round(n * 10) / 10;
}

/**
 * Normalize a per-process `PercentProcessorTime` (100 % = one logical core) to a
 * share of the whole machine (100 % = every core busy).
 */
function normalizeProcessCpu(percentOfOneCore, cores) {
  const n = toNumber(percentOfOneCore);
  if (n === null) return null;
  const c = toNumber(cores);
  if (!c || c <= 0) return round1(clampPercent(n));
  return round1(clampPercent(n / c));
}

/** Strip the `#N` instance suffix perf counters add to duplicate process names. */
function cleanProcessName(name) {
  return String(name ?? "").replace(/#\d+$/, "");
}

/**
 * Parse one stdout line of the PowerShell sensor. Returns `{ type: "sys", ... }`,
 * `{ type: "proc", items }`, `{ type: "error", ... }`, or `null` for anything that is not
 * a valid sensor record (blank line, PowerShell noise, malformed JSON).
 */
function parseSensorLine(line, { cores = os.cpus().length } = {}) {
  const text = String(line ?? "").trim();
  if (!text || text[0] !== "{") return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  if (raw.type === "sys") {
    const idle = toNumber(raw.diskIdle);
    const busy = toNumber(raw.diskTime);
    // % Idle Time is the reliable activity source (PercentDiskTime can exceed 100 % on
    // queued disks); fall back to the clamped busy time when idle is missing.
    const activePercent = idle !== null ? clampPercent(100 - idle) : clampPercent(busy);
    const read = toNumber(raw.readBps);
    const write = toNumber(raw.writeBps);
    const hasDisk = activePercent !== null || read !== null || write !== null;
    return {
      type: "sys",
      cpuPercent: clampPercent(raw.cpu),
      disk: hasDisk ? { activePercent, readBytesPerSec: read, writeBytesPerSec: write } : null,
    };
  }

  if (raw.type === "proc") {
    const list = Array.isArray(raw.items) ? raw.items : raw.items ? [raw.items] : [];
    const items = [];
    for (const p of list) {
      if (!p || typeof p !== "object") continue;
      const pid = toNumber(p.pid);
      if (pid === null) continue;
      const name = cleanProcessName(p.name);
      if (!name || name === "_Total" || name === "Idle") continue;
      items.push({
        name,
        pid,
        parentPid: toNumber(p.ppid),
        cpuPercent: normalizeProcessCpu(p.cpu, cores) ?? 0,
        memoryBytes: toNumber(p.mem) ?? 0,
      });
    }
    return { type: "proc", items };
  }

  if (raw.type === "error") {
    return { type: "error", scope: String(raw.scope || ""), message: String(raw.message || "") };
  }
  return null;
}

/** Parse one `[N/A]`-tolerant CSV field of nvidia-smi `--format=csv,noheader,nounits`. */
function nvidiaField(value) {
  const text = String(value ?? "").trim();
  if (!text || text.startsWith("[")) return null;
  return toNumber(text);
}

/**
 * Parse one nvidia-smi line produced by
 * `--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu
 *  --format=csv,noheader,nounits`. Unsupported fields (`[N/A]`, `[Not Supported]`)
 * become `null`. Returns `null` for a line that isn't a GPU reading.
 *
 * Laptop (Optimus) GPUs power down when idle; in `-l` mode nvidia-smi then prints
 * `[Unknown Error]` for utilization while memory/temperature still read. That case is
 * reported as 0 % with `lowPower: true` rather than as a missing value.
 */
function parseNvidiaLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  const parts = text.split(",");
  if (parts.length < 5) return null;
  const index = nvidiaField(parts[0]);
  if (index === null) return null;
  const lowPower = /unknown error/i.test(parts[1]);
  const utilPercent = lowPower ? 0 : clampPercent(nvidiaField(parts[1]));
  const memUsedMiB = nvidiaField(parts[2]);
  const memTotalMiB = nvidiaField(parts[3]);
  const temperatureC = nvidiaField(parts[4]);
  if (!lowPower && utilPercent === null && memUsedMiB === null && temperatureC === null) {
    return null;
  }
  const memPercent =
    memUsedMiB !== null && memTotalMiB
      ? round1(clampPercent((memUsedMiB / memTotalMiB) * 100))
      : null;
  return { index, utilPercent, memUsedMiB, memTotalMiB, memPercent, temperatureC, lowPower };
}

/** Busy/total tick counters summed across `os.cpus()`. */
function cpuTimes(cpus) {
  let idle = 0;
  let total = 0;
  for (const c of cpus || []) {
    const t = c && c.times;
    if (!t) continue;
    idle += t.idle || 0;
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.irq || 0) + (t.idle || 0);
  }
  return { idle, total };
}

/** Machine CPU % between two `cpuTimes()` snapshots, or null when undefined. */
function cpuPercentFromTimes(prev, next) {
  if (!prev || !next) return null;
  const total = next.total - prev.total;
  const idle = next.idle - prev.idle;
  if (!(total > 0)) return null;
  return round1(clampPercent(((total - idle) / total) * 100));
}

/** Backoff for the Nth consecutive restart (1-based): 2 s, 4 s, 8 s… capped at 60 s. */
function backoffDelay(attempt, base = BACKOFF_BASE_MS, max = BACKOFF_MAX_MS) {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(max, base * 2 ** (n - 1));
}

/**
 * Time-bounded, insertion-ordered rolling window. Samples older than `windowMs` relative
 * to the newest one are evicted, and `maxItems` is a hard cap on top of that.
 */
function createRollingWindow({ windowMs = WINDOW_MS, maxItems } = {}) {
  const cap = maxItems ?? Math.ceil(windowMs / SYS_INTERVAL_MS) + 10;
  const items = [];
  return {
    push(sample) {
      // Keep ascending order even if a clock step produces an older timestamp.
      if (items.length && sample.ts < items[items.length - 1].ts) items.length = 0;
      items.push(sample);
      const cutoff = sample.ts - windowMs;
      let drop = 0;
      while (drop < items.length && items[drop].ts < cutoff) drop++;
      if (items.length - drop > cap) drop = items.length - cap;
      if (drop > 0) items.splice(0, drop);
    },
    toArray() {
      return items.slice();
    },
    get size() {
      return items.length;
    },
    clear() {
      items.length = 0;
    },
  };
}

/** Keep the union of the top `limit` processes by CPU and by memory, sorted by CPU. */
function selectTopProcesses(items, limit = PROCESS_LIMIT) {
  const byCpu = [...items].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, limit);
  const byMem = [...items].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, limit);
  const seen = new Map();
  for (const p of [...byCpu, ...byMem]) seen.set(p.pid, p);
  return [...seen.values()].sort(
    (a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes
  );
}

// ── PowerShell sensor script ────────────────────────────────────────────────

/**
 * Build the PowerShell loop. It exits by itself once the dashboard process (`parentPid`)
 * is gone, so a hard-killed server never leaves an orphan sensor behind.
 */
function buildSensorScript({ parentPid, sysIntervalMs, procIntervalMs }) {
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$parentPid = ${Number(parentPid)}
$sysMs = ${Number(sysIntervalMs)}
$procMs = ${Number(procIntervalMs)}
$cpuQ = "SELECT PercentProcessorTime FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name='_Total'"
$diskQ = "SELECT PercentDiskTime,PercentIdleTime,DiskReadBytesPersec,DiskWriteBytesPersec FROM Win32_PerfFormattedData_PerfDisk_PhysicalDisk WHERE Name='_Total'"
$procQ = "SELECT Name,IDProcess,CreatingProcessID,PercentProcessorTime,WorkingSetPrivate FROM Win32_PerfFormattedData_PerfProc_Process WHERE Name<>'_Total' AND Name<>'Idle'"
$out = [Console]::Out
function Emit($o) { $out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 4)); $out.Flush() }
$nextProc = [DateTime]::MinValue
while ($true) {
  $start = [DateTime]::UtcNow
  try { $null = [System.Diagnostics.Process]::GetProcessById($parentPid) } catch { exit 0 }
  try {
    $c = Get-CimInstance -Query $cpuQ
    $d = Get-CimInstance -Query $diskQ
    Emit ([ordered]@{ type = 'sys'; cpu = $c.PercentProcessorTime; diskTime = $d.PercentDiskTime; diskIdle = $d.PercentIdleTime; readBps = $d.DiskReadBytesPersec; writeBps = $d.DiskWriteBytesPersec })
  } catch { Emit ([ordered]@{ type = 'error'; scope = 'sys'; message = "$_" }) }
  if ($start -ge $nextProc) {
    $nextProc = $start.AddMilliseconds($procMs)
    try {
      $items = @(Get-CimInstance -Query $procQ | ForEach-Object { [ordered]@{ name = $_.Name; pid = $_.IDProcess; ppid = $_.CreatingProcessID; cpu = $_.PercentProcessorTime; mem = $_.WorkingSetPrivate } })
      Emit ([ordered]@{ type = 'proc'; items = $items })
    } catch { Emit ([ordered]@{ type = 'error'; scope = 'proc'; message = "$_" }) }
  }
  $wait = $sysMs - ([DateTime]::UtcNow - $start).TotalMilliseconds
  if ($wait -lt 50) { $wait = 50 }
  Start-Sleep -Milliseconds ([int]$wait)
}
`;
}

/** PowerShell `-EncodedCommand` payload (base64 of UTF-16LE). */
function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

// ── Process supervision ─────────────────────────────────────────────────────

/**
 * Keep a long-lived child process running and feed its stdout lines to `onLine`.
 * `candidates` is a list of `{ command, args }` tried in order when one is missing
 * (ENOENT). Restarts after a death with `backoffDelay()`; the counter resets as soon
 * as the child produces a line `onLine` accepts (returns true).
 *
 * `giveUpIfNeverHealthy`: if the child dies/fails before ever producing an accepted
 * line, stop supervising and report `absent` (used for nvidia-smi on machines without
 * an NVIDIA GPU — that is not an error).
 */
function superviseProcess({
  name,
  candidates,
  spawn,
  onLine,
  onState,
  giveUpIfNeverHealthy = false,
  timers = { setTimeout, clearTimeout },
  backoff = backoffDelay,
}) {
  let child = null;
  let candidateIndex = 0;
  let attempts = 0;
  let everHealthy = false;
  let stopped = false;
  let restartTimer = null;

  function setState(state, extra) {
    if (onState) onState(state, extra || {});
  }

  function scheduleRestart(reason) {
    if (stopped) return;
    if (giveUpIfNeverHealthy && !everHealthy) {
      setState("absent", { reason });
      stopped = true;
      return;
    }
    attempts += 1;
    const delayMs = backoff(attempts);
    setState("unavailable", { reason, retryInMs: delayMs, attempts });
    restartTimer = timers.setTimeout(() => {
      restartTimer = null;
      launch();
    }, delayMs);
    if (restartTimer && typeof restartTimer.unref === "function") restartTimer.unref();
  }

  function launch() {
    if (stopped) return;
    const { command, args } = candidates[candidateIndex];
    let proc;
    let settled = false;
    let buffer = "";
    try {
      proc = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch (err) {
      handleFailure(err);
      return;
    }
    child = proc;

    function handleFailure(err) {
      if (settled) return;
      settled = true;
      if (child === proc) child = null;
      if (err && err.code === "ENOENT" && candidateIndex < candidates.length - 1) {
        candidateIndex += 1;
        launch();
        return;
      }
      scheduleRestart(err ? err.code || err.message : `${name} exited`);
    }

    if (proc.stdout) {
      proc.stdout.setEncoding?.("utf8");
      proc.stdout.on("data", (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          let accepted = false;
          try {
            accepted = onLine(line) === true;
          } catch {
            accepted = false;
          }
          if (accepted) {
            attempts = 0;
            if (!everHealthy) everHealthy = true;
          }
        }
        // Guard against a runaway line without a newline.
        if (buffer.length > 4 * 1024 * 1024) buffer = "";
      });
      proc.stdout.on("error", () => {});
    }
    proc.on("error", (err) => handleFailure(err));
    proc.on("exit", (code, signal) => {
      if (stopped) return;
      handleFailure(new Error(`${name} exited (${signal || code})`));
    });
  }

  return {
    start() {
      stopped = false;
      launch();
    },
    stop() {
      stopped = true;
      if (restartTimer) timers.clearTimeout(restartTimer);
      restartTimer = null;
      if (child) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
      child = null;
    },
    get child() {
      return child;
    },
  };
}

// ── Sensor orchestrator ─────────────────────────────────────────────────────

function systemVolumePath(platform) {
  if (platform === "win32") return `${process.env.SystemDrive || "C:"}\\`;
  return "/";
}

/**
 * Create a machine-metrics sensor. Every dependency is injectable so tests can drive it
 * with fake processes, clocks and platforms.
 */
function createMachineMetrics(options = {}) {
  const {
    platform = process.platform,
    spawn = childProcess.spawn,
    broadcast = () => {},
    osModule = os,
    statfs = (p, cb) => fs.statfs(p, cb),
    now = Date.now,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    sysIntervalMs = SYS_INTERVAL_MS,
    procIntervalMs = PROC_INTERVAL_MS,
    volumeIntervalMs = VOLUME_INTERVAL_MS,
    windowMs = WINDOW_MS,
    parentPid = process.pid,
    backoff = backoffDelay,
  } = options;

  const isWindows = platform === "win32";
  const cores = Math.max(1, (osModule.cpus() || []).length || 1);
  const samples = createRollingWindow({ windowMs });
  const volumePath = systemVolumePath(platform);

  const status = {
    sensor: isWindows ? "starting" : "unsupported",
    gpu: isWindows ? "starting" : "absent",
    sensorError: null,
    retryInMs: null,
  };

  let latestSys = null; // { ts, cpuPercent, disk }
  let latestProc = null; // { ts, items }
  const gpus = new Map(); // index -> { ts, ...reading }
  let volume = null;
  let prevCpuTimes = null;
  let tickTimer = null;
  let volumeTimer = null;
  let sensor = null;
  let gpuSensor = null;
  let running = false;

  function onSensorLine(line) {
    const rec = parseSensorLine(line, { cores });
    if (!rec) return false;
    const ts = now();
    if (rec.type === "sys") {
      latestSys = { ts, cpuPercent: rec.cpuPercent, disk: rec.disk };
    } else if (rec.type === "proc") {
      latestProc = { ts, items: selectTopProcesses(rec.items) };
    } else {
      status.sensorError = rec.message || null;
      return false;
    }
    status.sensor = "ok";
    status.sensorError = null;
    status.retryInMs = null;
    return true;
  }

  function onGpuLine(line) {
    const rec = parseNvidiaLine(line);
    if (!rec) return false;
    gpus.set(rec.index, { ts: now(), ...rec });
    status.gpu = "ok";
    return true;
  }

  function readVolume() {
    try {
      statfs(volumePath, (err, s) => {
        if (err || !s) return;
        const bsize = Number(s.bsize) || 0;
        const total = Number(s.blocks) * bsize;
        const free = Number(s.bfree) * bsize;
        if (!(total > 0)) return;
        const used = total - free;
        volume = {
          path: volumePath,
          usedBytes: used,
          totalBytes: total,
          percent: round1(clampPercent((used / total) * 100)),
        };
      });
    } catch {
      /* statfs unavailable (old Node) — no volume block */
    }
  }

  function fresh(entry, intervalMs) {
    return entry && now() - entry.ts <= intervalMs * STALE_FACTOR ? entry : null;
  }

  function osCpuPercent() {
    const next = cpuTimes(osModule.cpus());
    const pct = cpuPercentFromTimes(prevCpuTimes, next);
    prevCpuTimes = next;
    return pct;
  }

  function currentGpu() {
    if (!gpus.size) return null;
    const first = gpus.get(Math.min(...gpus.keys()));
    const live = fresh(first, sysIntervalMs);
    if (!live) return null;
    const { ts: _ts, ...reading } = live;
    return reading;
  }

  /** Build one sample from the latest readings, store it and broadcast it. */
  function tick() {
    const ts = now();
    const fallbackCpu = osCpuPercent();
    const sys = fresh(latestSys, sysIntervalMs);
    let cpu = null;
    if (sys && sys.cpuPercent !== null) cpu = { percent: sys.cpuPercent, source: "cim" };
    else if (fallbackCpu !== null) cpu = { percent: fallbackCpu, source: "os" };

    const total = osModule.totalmem();
    const free = osModule.freemem();
    const used = Math.max(0, total - free);

    const sample = {
      ts,
      cpu,
      ram: {
        usedBytes: used,
        totalBytes: total,
        percent: total > 0 ? round1(clampPercent((used / total) * 100)) : null,
      },
      disk: sys ? sys.disk : null,
      volume,
      gpu: currentGpu(),
    };
    samples.push(sample);
    try {
      broadcast("machine.sample", { sample, processes: getProcesses(), status: getStatus() });
    } catch {
      /* broadcasting must never break sampling */
    }
    return sample;
  }

  function getProcesses() {
    const p = fresh(latestProc, procIntervalMs);
    return p ? { ts: p.ts, cores, items: p.items } : null;
  }

  function getStatus() {
    return { ...status };
  }

  function start() {
    if (running) return api;
    running = true;
    prevCpuTimes = cpuTimes(osModule.cpus());
    readVolume();
    volumeTimer = timers.setInterval(readVolume, volumeIntervalMs);
    volumeTimer?.unref?.();

    if (isWindows) {
      const encoded = encodePowerShell(
        buildSensorScript({ parentPid, sysIntervalMs, procIntervalMs })
      );
      const psArgs = ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];
      sensor = superviseProcess({
        name: "machine sensor",
        candidates: [
          { command: "pwsh", args: psArgs },
          { command: "powershell.exe", args: psArgs },
        ],
        spawn,
        onLine: onSensorLine,
        timers,
        backoff,
        onState(state, extra) {
          if (state === "unavailable") {
            status.sensor = "unavailable";
            status.sensorError = extra.reason || null;
            status.retryInMs = extra.retryInMs ?? null;
            latestSys = null;
            latestProc = null;
          }
        },
      });
      sensor.start();

      gpuSensor = superviseProcess({
        name: "nvidia-smi",
        candidates: [
          {
            command: "nvidia-smi",
            args: [
              "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu",
              "--format=csv,noheader,nounits",
              "-l",
              String(Math.max(1, Math.round(sysIntervalMs / 1000))),
            ],
          },
        ],
        spawn,
        onLine: onGpuLine,
        giveUpIfNeverHealthy: true,
        timers,
        backoff,
        onState(state) {
          gpus.clear();
          status.gpu = state === "absent" ? "absent" : "unavailable";
        },
      });
      gpuSensor.start();
    }

    tickTimer = timers.setInterval(tick, sysIntervalMs);
    tickTimer?.unref?.();
    return api;
  }

  function stop() {
    running = false;
    if (tickTimer) timers.clearInterval(tickTimer);
    if (volumeTimer) timers.clearInterval(volumeTimer);
    tickTimer = null;
    volumeTimer = null;
    sensor?.stop();
    gpuSensor?.stop();
    sensor = null;
    gpuSensor = null;
  }

  function snapshot() {
    return {
      platform,
      cores,
      intervalMs: sysIntervalMs,
      processIntervalMs: procIntervalMs,
      windowMs,
      status: getStatus(),
      samples: samples.toArray(),
      processes: getProcesses(),
    };
  }

  const api = {
    start,
    stop,
    tick,
    snapshot,
    get running() {
      return running;
    },
    // Test hooks
    _onSensorLine: onSensorLine,
    _onGpuLine: onGpuLine,
    _children: () => ({ sensor: sensor?.child ?? null, gpu: gpuSensor?.child ?? null }),
  };
  return api;
}

// ── Process-wide singleton used by server/index.js and the route ─────────────

let instance = null;
let exitHookInstalled = false;

function startMachineMetrics({ broadcast } = {}) {
  if (instance) return instance;
  instance = createMachineMetrics({ broadcast });
  instance.start();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Last-resort cleanup: kill the PowerShell / nvidia-smi children on any exit path.
    process.on("exit", stopMachineMetrics);
  }
  return instance;
}

function stopMachineMetrics() {
  if (!instance) return;
  instance.stop();
  instance = null;
}

function getMachineSnapshot() {
  if (instance) return instance.snapshot();
  return {
    platform: process.platform,
    cores: os.cpus().length,
    intervalMs: SYS_INTERVAL_MS,
    processIntervalMs: PROC_INTERVAL_MS,
    windowMs: WINDOW_MS,
    status: {
      sensor: "disabled",
      gpu: "disabled",
      sensorError: null,
      retryInMs: null,
    },
    samples: [],
    processes: null,
  };
}

module.exports = {
  SYS_INTERVAL_MS,
  PROC_INTERVAL_MS,
  VOLUME_INTERVAL_MS,
  WINDOW_MS,
  PROCESS_LIMIT,
  parseSensorLine,
  parseNvidiaLine,
  normalizeProcessCpu,
  cleanProcessName,
  cpuTimes,
  cpuPercentFromTimes,
  backoffDelay,
  createRollingWindow,
  selectTopProcesses,
  buildSensorScript,
  encodePowerShell,
  superviseProcess,
  createMachineMetrics,
  startMachineMetrics,
  stopMachineMetrics,
  getMachineSnapshot,
};
