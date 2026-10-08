/**
 * @file Reads the per-process files Claude Code keeps for every running instance
 * (`<claude home>/sessions/<pid>.json`, holding `pid` and `sessionId` among other
 * fields) and feeds those PID → session links into the session-process registry. This
 * complements the `claude_pid` sent by hooks: after a dashboard restart, a session that
 * stays idle sends no hook, yet its file already links it to its claude process. Only
 * `pid`, `sessionId` and `startedAt` are kept; nothing else from the files is read out.
 */

const fs = require("fs");
const path = require("path");
const { getClaudeHome } = require("./claude-home");

const SYNC_INTERVAL_MS = 30_000;
const SESSION_FILE = /^(\d+)\.json$/;

/** Default location of Claude Code's per-process session files. */
function claudeSessionsDir() {
  return path.join(getClaudeHome(), "sessions");
}

/**
 * PID → session links from `dir`, oldest instance first so that, when a stale file
 * shares a PID with a live one, the newest is recorded last and wins. Unreadable,
 * malformed or mismatched files (JSON `pid` ≠ file name) are skipped.
 *
 * @returns {Array<{pid:number, sessionId:string, startedAt:number}>}
 */
function readClaudeSessionFiles(dir = claudeSessionsDir()) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const links = [];
  for (const name of names) {
    const match = SESSION_FILE.exec(name);
    if (!match) continue;
    try {
      const { pid, sessionId, startedAt } = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8")
      );
      if (pid !== Number(match[1]) || typeof sessionId !== "string" || !sessionId) continue;
      links.push({ pid, sessionId, startedAt: Number.isFinite(startedAt) ? startedAt : 0 });
    } catch {
      /* file mid-write or corrupt: picked up on the next sync */
    }
  }
  return links.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Record the links into `registry` now and every `intervalMs`.
 *
 * @returns {() => void} stop
 */
function startClaudeSessionFileSync({
  registry,
  dir = claudeSessionsDir(),
  intervalMs = SYNC_INTERVAL_MS,
  timers = { setInterval, clearInterval },
}) {
  const sync = () => {
    for (const { pid, sessionId } of readClaudeSessionFiles(dir)) registry.record(sessionId, pid);
  };
  sync();
  const handle = timers.setInterval(sync, intervalMs);
  handle?.unref?.();
  return () => timers.clearInterval(handle);
}

module.exports = {
  SYNC_INTERVAL_MS,
  claudeSessionsDir,
  readClaudeSessionFiles,
  startClaudeSessionFileSync,
};
