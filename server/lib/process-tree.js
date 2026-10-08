/**
 * @file Pure helpers over a flat process list (`{ pid, parentPid, name, cpuPercent }`)
 * as produced by the machine-metrics sensor: Claude Code process detection and the CPU
 * share of a process subtree. No I/O — shared by the machine-wide "claude + its
 * commands" reading and the per-session readings.
 */

const CLAUDE_PROCESS_NAME = /^claude(\.exe)?$/i;

/** True for Claude Code processes (`claude`, `claude.exe`, any case). */
function isClaudeProcessName(name) {
  return CLAUDE_PROCESS_NAME.test(String(name ?? "").trim());
}

/** Map `parentPid -> children`, skipping self-parented entries. */
function childrenByParent(items) {
  const children = new Map();
  for (const p of items) {
    if (p.parentPid === null || p.parentPid === undefined || p.parentPid === p.pid) continue;
    if (!children.has(p.parentPid)) children.set(p.parentPid, []);
    children.get(p.parentPid).push(p);
  }
  return children;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Summed CPU share of the given root processes and all their descendants, each process
 * counted once (overlapping roots, parent loops). Roots absent from `items` add nothing.
 * Capped at 100. A recycled PID can in theory adopt an orphan into a subtree; perf
 * counters carry no creation time to rule that out.
 *
 * @param {Array<{pid:number,parentPid:number|null,cpuPercent:number}>} items
 * @param {Iterable<number>} rootPids
 * @param {Map<number, Array>} [children] precomputed `childrenByParent(items)`
 */
function subtreeCpuPercent(items, rootPids, children = childrenByParent(items)) {
  const byPid = new Map(items.map((p) => [p.pid, p]));
  const stack = [...rootPids].map((pid) => byPid.get(pid)).filter(Boolean);
  const visited = new Set();
  let total = 0;
  while (stack.length) {
    const p = stack.pop();
    if (visited.has(p.pid)) continue;
    visited.add(p.pid);
    total += Number.isFinite(p.cpuPercent) ? p.cpuPercent : 0;
    for (const child of children.get(p.pid) || []) stack.push(child);
  }
  return round1(Math.min(100, total));
}

module.exports = {
  isClaudeProcessName,
  childrenByParent,
  subtreeCpuPercent,
};
