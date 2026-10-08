/**
 * @file In-memory registry linking a Claude Code session to the `claude` process that
 * runs it. Claude Code exports its own PID to every child as `CLAUDE_PID`; the hook
 * handler forwards it with each event (`claude_pid`) and the hooks route records it
 * here. The machine-metrics sensor then reads, per session, the CPU share of that
 * process and everything it spawned. Nothing is persisted: after a dashboard restart
 * the link comes back with the session's next hook.
 */

const { isClaudeProcessName, childrenByParent, subtreeCpuPercent } = require("./process-tree");

// A just-recorded PID may be missing from a process snapshot taken moments earlier;
// keep it this long before treating its absence as "process gone".
const DEFAULT_GRACE_MS = 15_000;

function isValidPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {number} [options.graceMs]
 */
function createSessionProcessRegistry({ now = Date.now, graceMs = DEFAULT_GRACE_MS } = {}) {
  const entries = new Map(); // sessionId -> { pid, recordedAt }

  /**
   * Link `sessionId` to `pid`. One claude process runs one session at a time, so a
   * session previously linked to the same PID (e.g. before `/clear`) is unlinked.
   * Invalid input is ignored: hooks from older handlers carry no PID.
   */
  function record(sessionId, pid) {
    if (typeof sessionId !== "string" || !sessionId || !isValidPid(pid)) return false;
    for (const [otherId, entry] of entries) {
      if (entry.pid === pid && otherId !== sessionId) entries.delete(otherId);
    }
    entries.set(sessionId, { pid, recordedAt: now() });
    return true;
  }

  /**
   * CPU share (whole machine, 0–100) of each linked session's claude process and its
   * descendants, from a full process list. Drops links whose process is gone or whose
   * PID now belongs to something other than claude (recycled PID), once past the grace
   * period.
   *
   * @returns {Record<string, number>}
   */
  function cpuBySession(items, children = childrenByParent(items)) {
    const byPid = new Map(items.map((p) => [p.pid, p]));
    const cutoff = now() - graceMs;
    const result = {};
    for (const [sessionId, { pid, recordedAt }] of entries) {
      const root = byPid.get(pid);
      if (root && isClaudeProcessName(root.name)) {
        result[sessionId] = subtreeCpuPercent(items, [pid], children);
      } else if (recordedAt < cutoff) {
        entries.delete(sessionId);
      }
    }
    return result;
  }

  return {
    record,
    cpuBySession,
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}

/** Registry shared by the hooks route (writer) and the machine-metrics sensor (reader). */
const sessionProcesses = createSessionProcessRegistry();

module.exports = {
  DEFAULT_GRACE_MS,
  createSessionProcessRegistry,
  sessionProcesses,
};
