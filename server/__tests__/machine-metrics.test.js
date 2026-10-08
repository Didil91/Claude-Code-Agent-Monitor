/**
 * @file Tests for server/lib/machine-metrics.js: parsing of PowerShell sensor and
 * nvidia-smi lines (nominal, missing values, invalid lines), rolling-window bounds and
 * order, per-process CPU normalization, restart-with-backoff after the sensor dies
 * (simulated child process), and degradation without NVIDIA and off Windows.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const mm = require("../lib/machine-metrics");
const { createSessionProcessRegistry } = require("../lib/session-processes");

// ── Fakes ───────────────────────────────────────────────────────────────────

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.writeLine = (line) => child.stdout.write(`${line}\r\n`);
  return child;
}

/** spawn() double: records calls; `behaviour(command)` may return "enoent". */
function fakeSpawn(behaviour = () => null) {
  const calls = [];
  const spawn = (command, args) => {
    const child = fakeChild();
    calls.push({ command, args, child });
    if (behaviour(command) === "enoent") {
      setImmediate(() =>
        child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }))
      );
    }
    return child;
  };
  spawn.calls = calls;
  spawn.byCommand = (cmd) => calls.filter((c) => c.command === cmd);
  return spawn;
}

/** Manual timers: nothing fires until `runPending()` is called. */
function fakeTimers() {
  const pending = [];
  return {
    pending,
    setTimeout(fn, ms) {
      const t = { fn, ms, cleared: false };
      pending.push(t);
      return t;
    },
    clearTimeout(t) {
      if (t) t.cleared = true;
    },
    setInterval(fn, ms) {
      return { fn, ms, interval: true };
    },
    clearInterval() {},
    runPending() {
      const due = pending.splice(0).filter((t) => !t.cleared);
      for (const t of due) t.fn();
      return due.map((t) => t.ms);
    },
  };
}

function fakeOs({ cores = 4, total = 16e9, free = 4e9 } = {}) {
  let busy = 0;
  let idle = 0;
  return {
    cpus() {
      return Array.from({ length: cores }, () => ({
        times: { user: busy, nice: 0, sys: 0, irq: 0, idle },
      }));
    },
    advance(b, i) {
      busy += b;
      idle += i;
    },
    totalmem: () => total,
    freemem: () => free,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

// ── Parsing ─────────────────────────────────────────────────────────────────

describe("parseSensorLine", () => {
  it("parses a nominal sys record", () => {
    const rec = mm.parseSensorLine(
      '{"type":"sys","cpu":25,"diskTime":7,"diskIdle":96,"readBps":1024,"writeBps":2048}'
    );
    assert.deepEqual(rec, {
      type: "sys",
      cpuPercent: 25,
      disk: { activePercent: 4, readBytesPerSec: 1024, writeBytesPerSec: 2048 },
    });
  });

  it("clamps disk activity and falls back to PercentDiskTime when idle is missing", () => {
    const rec = mm.parseSensorLine('{"type":"sys","cpu":5,"diskTime":340}');
    assert.equal(rec.disk.activePercent, 100);
    assert.equal(rec.disk.readBytesPerSec, null);
  });

  it("returns null fields for missing values", () => {
    const rec = mm.parseSensorLine('{"type":"sys"}');
    assert.deepEqual(rec, { type: "sys", cpuPercent: null, disk: null });
  });

  it("parses processes, normalizes CPU by cores and strips #N suffixes", () => {
    const rec = mm.parseSensorLine(
      JSON.stringify({
        type: "proc",
        items: [
          { name: "node#2", pid: 10, ppid: 1, cpu: 200, mem: 5000 },
          { name: "_Total", pid: 0, cpu: 1200, mem: 1 },
          { name: "Idle", pid: 0, cpu: 900, mem: 1 },
          { name: "nopid", cpu: 1 },
          { name: "claude", pid: 11, ppid: null, cpu: null, mem: null },
        ],
      }),
      { cores: 4 }
    );
    assert.deepEqual(rec.items, [
      { name: "node", pid: 10, parentPid: 1, cpuPercent: 50, memoryBytes: 5000 },
      { name: "claude", pid: 11, parentPid: null, cpuPercent: 0, memoryBytes: 0 },
    ]);
  });

  it("accepts a single process serialized as an object instead of an array", () => {
    const rec = mm.parseSensorLine('{"type":"proc","items":{"name":"a","pid":1,"cpu":4,"mem":2}}', {
      cores: 2,
    });
    assert.equal(rec.items.length, 1);
    assert.equal(rec.items[0].cpuPercent, 2);
  });

  it("parses sensor error records", () => {
    assert.deepEqual(mm.parseSensorLine('{"type":"error","scope":"proc","message":"boom"}'), {
      type: "error",
      scope: "proc",
      message: "boom",
    });
  });

  it("rejects invalid lines", () => {
    for (const line of ["", "   ", "garbage", "{not json", "[1,2]", '{"type":"other"}', null]) {
      assert.equal(mm.parseSensorLine(line), null, `line: ${line}`);
    }
  });
});

describe("parseNvidiaLine", () => {
  it("parses a nominal line", () => {
    assert.deepEqual(mm.parseNvidiaLine("0, 39, 1024, 4096, 49"), {
      index: 0,
      utilPercent: 39,
      memUsedMiB: 1024,
      memTotalMiB: 4096,
      memPercent: 25,
      temperatureC: 49,
      lowPower: false,
    });
  });

  it("maps [N/A] / [Not Supported] to null", () => {
    const rec = mm.parseNvidiaLine("1, [N/A], 512, [Not Supported], 60");
    assert.equal(rec.utilPercent, null);
    assert.equal(rec.memTotalMiB, null);
    assert.equal(rec.memPercent, null);
    assert.equal(rec.temperatureC, 60);
  });

  it("reports a powered-down laptop GPU ([Unknown Error]) as 0 % in low power", () => {
    const rec = mm.parseNvidiaLine("0, [Unknown Error], 0, 4096, 50");
    assert.equal(rec.utilPercent, 0);
    assert.equal(rec.lowPower, true);
  });

  it("rejects invalid lines", () => {
    for (const line of [
      "",
      "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.",
      "1, 2, 3",
      "x, 1, 2, 3, 4",
      "0, [N/A], [N/A], [N/A], [N/A]",
    ]) {
      assert.equal(mm.parseNvidiaLine(line), null, `line: ${line}`);
    }
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

describe("normalizeProcessCpu", () => {
  it("divides per-core percentages by the core count", () => {
    assert.equal(mm.normalizeProcessCpu(600, 12), 50);
    assert.equal(mm.normalizeProcessCpu(100, 12), 8.3);
    assert.equal(mm.normalizeProcessCpu(0, 12), 0);
  });

  it("clamps to 0..100 and handles missing values", () => {
    assert.equal(mm.normalizeProcessCpu(5000, 4), 100);
    assert.equal(mm.normalizeProcessCpu(null, 4), null);
    assert.equal(mm.normalizeProcessCpu(40, 0), 40);
  });
});

describe("createRollingWindow", () => {
  it("keeps only the last windowMs of samples, in order", () => {
    const w = mm.createRollingWindow({ windowMs: 10_000 });
    for (let ts = 0; ts <= 30_000; ts += 2_000) w.push({ ts });
    const arr = w.toArray();
    assert.equal(arr[0].ts, 20_000);
    assert.equal(arr.at(-1).ts, 30_000);
    for (let i = 1; i < arr.length; i++) assert.ok(arr[i].ts > arr[i - 1].ts);
  });

  it("enforces a hard item cap", () => {
    const w = mm.createRollingWindow({ windowMs: 1e9, maxItems: 5 });
    for (let ts = 0; ts < 100; ts++) w.push({ ts });
    assert.equal(w.size, 5);
    assert.deepEqual(
      w.toArray().map((s) => s.ts),
      [95, 96, 97, 98, 99]
    );
  });

  it("the default 5-minute window is bounded to ~150 samples at 2 s", () => {
    const w = mm.createRollingWindow();
    for (let i = 0; i < 1000; i++) w.push({ ts: i * 2_000 });
    assert.ok(w.size <= 151, `size ${w.size}`);
    assert.ok(w.size >= 150);
  });

  it("resets on a backwards clock step instead of storing out-of-order samples", () => {
    const w = mm.createRollingWindow({ windowMs: 10_000 });
    w.push({ ts: 5_000 });
    w.push({ ts: 6_000 });
    w.push({ ts: 1_000 });
    assert.deepEqual(
      w.toArray().map((s) => s.ts),
      [1_000]
    );
  });
});

describe("cpuPercentFromTimes / backoffDelay / selectTopProcesses", () => {
  it("computes machine CPU from two os.cpus() snapshots", () => {
    const a = mm.cpuTimes([{ times: { user: 100, nice: 0, sys: 0, irq: 0, idle: 100 } }]);
    const b = mm.cpuTimes([{ times: { user: 175, nice: 0, sys: 0, irq: 0, idle: 125 } }]);
    assert.equal(mm.cpuPercentFromTimes(a, b), 75);
    assert.equal(mm.cpuPercentFromTimes(a, a), null);
    assert.equal(mm.cpuPercentFromTimes(null, b), null);
  });

  it("backs off 2, 4, 8… seconds capped at 60", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 10].map((n) => mm.backoffDelay(n)),
      [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]
    );
  });

  it("keeps the union of top CPU and top memory processes", () => {
    const items = [
      { pid: 1, cpuPercent: 50, memoryBytes: 1 },
      { pid: 2, cpuPercent: 1, memoryBytes: 900 },
      { pid: 3, cpuPercent: 2, memoryBytes: 2 },
    ];
    assert.deepEqual(
      mm.selectTopProcesses(items, 1).map((p) => p.pid),
      [1, 2]
    );
  });
});

describe("claudeTreeCpuPercent", () => {
  const p = (pid, parentPid, name, cpuPercent) => ({
    pid,
    parentPid,
    name,
    cpuPercent,
    memoryBytes: 1,
  });

  it("sums claude and every descendant, through intermediate shells", () => {
    const items = [
      p(10, 1, "claude", 0.5),
      p(11, 10, "cmd", 0),
      p(12, 11, "node", 20),
      p(13, 12, "node", 5.3),
      p(20, 1, "node", 90), // unrelated
    ];
    assert.equal(mm.claudeTreeCpuPercent(items), 25.8);
  });

  it("counts a claude nested under another claude once", () => {
    const items = [p(10, 1, "claude", 1), p(11, 10, "claude", 2), p(12, 11, "git", 3)];
    assert.equal(mm.claudeTreeCpuPercent(items), 6);
  });

  it("survives parent loops and ignores processes outside the tree", () => {
    const items = [p(10, 12, "claude", 1), p(11, 10, "node", 2), p(12, 11, "node", 3)];
    assert.equal(mm.claudeTreeCpuPercent(items), 6);
    assert.equal(mm.claudeTreeCpuPercent([p(5, 4, "node", 50)]), 0);
    assert.equal(mm.claudeTreeCpuPercent([]), 0);
  });

  it("does not count a process as its own child", () => {
    assert.equal(mm.claudeTreeCpuPercent([p(10, 10, "claude", 4)]), 4);
  });
});

// ── Supervisor and orchestrator ─────────────────────────────────────────────

describe("createMachineMetrics on Windows", () => {
  function setup(spawnBehaviour, extraOptions = {}) {
    const spawn = fakeSpawn(spawnBehaviour);
    const timers = fakeTimers();
    const sent = [];
    const fos = fakeOs({ cores: 4 });
    let clock = 1_000_000;
    const metrics = mm.createMachineMetrics({
      platform: "win32",
      spawn,
      timers,
      osModule: fos,
      statfs: (_p, cb) => cb(null, { bsize: 4096, blocks: 1000, bfree: 250 }),
      now: () => clock,
      broadcast: (type, data) => sent.push({ type, data }),
      ...extraOptions,
    });
    return { spawn, timers, sent, fos, metrics, advance: (ms) => (clock += ms) };
  }

  it("collects CPU, RAM, disk, volume, GPU and processes and broadcasts machine.sample", async () => {
    const { spawn, sent, metrics } = setup();
    metrics.start();
    const ps = spawn.byCommand("pwsh")[0];
    assert.ok(ps, "pwsh spawned");
    assert.deepEqual(ps.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    const gpu = spawn.byCommand("nvidia-smi")[0];
    assert.ok(gpu.args.includes("-l"));

    ps.child.writeLine(
      '{"type":"sys","cpu":20,"diskTime":2,"diskIdle":98,"readBps":1,"writeBps":2}'
    );
    ps.child.writeLine(
      '{"type":"proc","items":[{"name":"claude","pid":42,"ppid":7,"cpu":400,"mem":1048576}]}'
    );
    gpu.child.writeLine("0, 39, 1024, 4096, 49");
    await flush();

    const sample = metrics.tick();
    assert.deepEqual(sample.cpu, { percent: 20, source: "cim" });
    assert.equal(sample.ram.percent, 75);
    assert.deepEqual(sample.disk, { activePercent: 2, readBytesPerSec: 1, writeBytesPerSec: 2 });
    assert.equal(sample.volume.percent, 75);
    assert.equal(sample.gpu.utilPercent, 39);
    assert.equal(sample.gpu.temperatureC, 49);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "machine.sample");
    assert.deepEqual(sent[0].data.processes.items, [
      { name: "claude", pid: 42, parentPid: 7, cpuPercent: 100, memoryBytes: 1048576 },
    ]);
    assert.equal(sent[0].data.processes.claudeTreeCpuPercent, 100);

    const snap = metrics.snapshot();
    assert.equal(snap.status.sensor, "ok");
    assert.equal(snap.status.gpu, "ok");
    assert.equal(snap.samples.length, 1);
    metrics.stop();
  });

  it("counts claude descendants that fall outside the top processes", async () => {
    const { spawn, metrics } = setup();
    metrics.start();
    const ps = spawn.byCommand("pwsh")[0];
    // Heavy unrelated processes fill the top list; the claude chain stays light.
    const heavy = Array.from({ length: mm.PROCESS_LIMIT + 5 }, (_, i) => ({
      name: "busy",
      pid: 1000 + i,
      ppid: 1,
      cpu: 40,
      mem: 1e9,
    }));
    const chain = [
      { name: "claude", pid: 42, ppid: 7, cpu: 0, mem: 10 },
      { name: "cmd", pid: 43, ppid: 42, cpu: 0, mem: 1 },
      { name: "node", pid: 44, ppid: 43, cpu: 8, mem: 1 },
    ];
    ps.child.writeLine(JSON.stringify({ type: "proc", items: [...heavy, ...chain] }));
    await flush();

    const procs = metrics.snapshot().processes;
    assert.ok(!procs.items.some((p) => p.pid === 44), "node child is outside the top list");
    assert.equal(procs.claudeTreeCpuPercent, 2); // 8 % of one core on 4 cores
    metrics.stop();
  });

  it("reports the CPU of each session linked to its claude process", async () => {
    const sessionRegistry = createSessionProcessRegistry();
    const { spawn, metrics } = setup(undefined, { sessionRegistry });
    sessionRegistry.record("session-a", 42);
    metrics.start();
    const ps = spawn.byCommand("pwsh")[0];
    const items = [
      { name: "claude", pid: 42, ppid: 7, cpu: 4, mem: 10 },
      { name: "bash", pid: 43, ppid: 42, cpu: 0, mem: 1 },
      { name: "node", pid: 44, ppid: 43, cpu: 12, mem: 1 },
      { name: "claude", pid: 50, ppid: 7, cpu: 40, mem: 10 }, // unlinked session
    ];
    ps.child.writeLine(JSON.stringify({ type: "proc", items }));
    await flush();

    assert.deepEqual(metrics.snapshot().processes.cpuBySession, { "session-a": 4 });
    metrics.stop();
  });

  it("restarts a dead sensor with growing backoff, exposes 'unavailable', and recovers", async () => {
    const { spawn, timers, metrics } = setup();
    metrics.start();
    const first = spawn.byCommand("pwsh")[0].child;
    first.writeLine('{"type":"sys","cpu":10}');
    await flush();
    assert.equal(metrics.snapshot().status.sensor, "ok");

    first.emit("exit", 1, null);
    let status = metrics.snapshot().status;
    assert.equal(status.sensor, "unavailable");
    assert.equal(status.retryInMs, 2_000);
    assert.deepEqual(timers.runPending(), [2_000]);
    assert.equal(spawn.byCommand("pwsh").length, 2);

    // Dies again without producing a line: next delay doubles.
    spawn.byCommand("pwsh")[1].child.emit("exit", 1, null);
    assert.equal(metrics.snapshot().status.retryInMs, 4_000);
    assert.deepEqual(timers.runPending(), [4_000]);
    spawn.byCommand("pwsh")[2].child.emit("exit", 1, null);
    assert.equal(metrics.snapshot().status.retryInMs, 8_000);
    timers.runPending();

    // A healthy line resets the backoff and the status.
    const fourth = spawn.byCommand("pwsh")[3].child;
    fourth.writeLine('{"type":"sys","cpu":11}');
    await flush();
    status = metrics.snapshot().status;
    assert.equal(status.sensor, "ok");
    assert.equal(status.retryInMs, null);
    fourth.emit("exit", 1, null);
    assert.equal(metrics.snapshot().status.retryInMs, 2_000);
    metrics.stop();
  });

  it("falls back to powershell.exe when pwsh is missing", async () => {
    const { spawn, metrics } = setup((cmd) => (cmd === "pwsh" ? "enoent" : null));
    metrics.start();
    await flush();
    assert.equal(spawn.byCommand("powershell.exe").length, 1);
    metrics.stop();
  });

  it("without NVIDIA: no GPU block, status 'absent', no retry", async () => {
    const { spawn, timers, metrics } = setup((cmd) => (cmd === "nvidia-smi" ? "enoent" : null));
    metrics.start();
    await flush();
    const snapStatus = metrics.snapshot().status;
    assert.equal(snapStatus.gpu, "absent");
    timers.runPending();
    assert.equal(spawn.byCommand("nvidia-smi").length, 1, "nvidia-smi not retried");
    assert.equal(metrics.tick().gpu, null);
    metrics.stop();
  });

  it("nvidia-smi failing without a valid line (no driver) is also 'absent'", async () => {
    const { spawn, metrics } = setup();
    metrics.start();
    const gpu = spawn.byCommand("nvidia-smi")[0].child;
    gpu.writeLine("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.");
    await flush();
    gpu.emit("exit", 9, null);
    assert.equal(metrics.snapshot().status.gpu, "absent");
    metrics.stop();
  });

  it("drops stale readings and falls back to os.cpus() CPU", async () => {
    const { spawn, fos, metrics, advance } = setup();
    metrics.start();
    spawn.byCommand("pwsh")[0].child.writeLine('{"type":"sys","cpu":80,"diskIdle":50}');
    await flush();
    advance(60_000);
    fos.advance(30, 10);
    const sample = metrics.tick();
    assert.deepEqual(sample.cpu, { percent: 75, source: "os" });
    assert.equal(sample.disk, null);
    assert.equal(metrics.snapshot().processes, null);
    metrics.stop();
  });

  it("stop() kills the sensor and nvidia-smi children and cancels restarts", async () => {
    const { spawn, timers, metrics } = setup();
    metrics.start();
    const ps = spawn.byCommand("pwsh")[0].child;
    const gpu = spawn.byCommand("nvidia-smi")[0].child;
    metrics.stop();
    assert.equal(ps.killed, true);
    assert.equal(gpu.killed, true);
    ps.emit("exit", null, "SIGTERM");
    timers.runPending();
    assert.equal(spawn.byCommand("pwsh").length, 1, "no restart after stop");
  });
});

describe("createMachineMetrics off Windows", () => {
  it("spawns nothing and samples CPU from os.cpus(), RAM and disk space", () => {
    const spawn = fakeSpawn();
    const fos = fakeOs({ cores: 2, total: 8e9, free: 6e9 });
    const metrics = mm.createMachineMetrics({
      platform: "linux",
      spawn,
      timers: fakeTimers(),
      osModule: fos,
      statfs: (p, cb) => cb(null, { bsize: 1, blocks: 100, bfree: 40 }),
    });
    metrics.start();
    assert.equal(spawn.calls.length, 0);
    fos.advance(10, 30);
    const sample = metrics.tick();
    assert.deepEqual(sample.cpu, { percent: 25, source: "os" });
    assert.equal(sample.ram.percent, 25);
    assert.equal(sample.volume.path, "/");
    assert.equal(sample.volume.percent, 60);
    assert.equal(sample.disk, null);
    assert.equal(sample.gpu, null);
    const snap = metrics.snapshot();
    assert.equal(snap.status.sensor, "unsupported");
    assert.equal(snap.status.gpu, "absent");
    assert.equal(snap.processes, null);
    metrics.stop();
  });
});

describe("GET /api/machine", () => {
  it("returns the disabled snapshot shape when the sensor is not running", () => {
    const snap = mm.getMachineSnapshot();
    assert.equal(snap.status.sensor, "disabled");
    assert.deepEqual(snap.samples, []);
    assert.equal(snap.windowMs, 5 * 60 * 1000);
  });

  it("buildSensorScript queries the language-independent CIM classes, not Get-Counter", () => {
    const script = mm.buildSensorScript({
      parentPid: 1,
      sysIntervalMs: 2000,
      procIntervalMs: 5000,
    });
    assert.match(script, /Win32_PerfFormattedData_PerfOS_Processor/);
    assert.match(script, /Win32_PerfFormattedData_PerfDisk_PhysicalDisk/);
    assert.match(script, /Win32_PerfFormattedData_PerfProc_Process/);
    assert.doesNotMatch(script, /Get-Counter/);
  });
});
