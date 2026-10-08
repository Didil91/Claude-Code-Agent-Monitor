/**
 * @file Tests for server/lib/process-tree.js: claude process detection and the CPU
 * share of a process subtree (descendants through shells, overlapping roots counted
 * once, parent loops, missing roots, cap at 100).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const tree = require("../lib/process-tree");

const p = (pid, parentPid, name, cpuPercent) => ({ pid, parentPid, name, cpuPercent });

describe("isClaudeProcessName", () => {
  it("matches claude and claude.exe in any case, nothing else", () => {
    assert.equal(tree.isClaudeProcessName("claude"), true);
    assert.equal(tree.isClaudeProcessName("Claude.EXE"), true);
    assert.equal(tree.isClaudeProcessName(" claude "), true);
    assert.equal(tree.isClaudeProcessName("claude-helper"), false);
    assert.equal(tree.isClaudeProcessName(null), false);
  });
});

describe("subtreeCpuPercent", () => {
  const items = [
    p(10, 1, "claude", 1),
    p(11, 10, "bash", 0),
    p(12, 11, "node", 20),
    p(20, 1, "claude", 2),
    p(21, 20, "git", 3),
    p(30, 1, "node", 90),
  ];

  it("sums a root and every descendant", () => {
    assert.equal(tree.subtreeCpuPercent(items, [10]), 21);
    assert.equal(tree.subtreeCpuPercent(items, [20]), 5);
  });

  it("counts overlapping roots once", () => {
    assert.equal(tree.subtreeCpuPercent(items, [10, 12, 20]), 26);
  });

  it("ignores roots absent from the list", () => {
    assert.equal(tree.subtreeCpuPercent(items, [999]), 0);
    assert.equal(tree.subtreeCpuPercent([], [10]), 0);
  });

  it("survives parent loops and self-parented entries", () => {
    const loop = [p(1, 3, "a", 1), p(2, 1, "b", 1), p(3, 2, "c", 1), p(4, 4, "d", 5)];
    assert.equal(tree.subtreeCpuPercent(loop, [1]), 3);
    assert.equal(tree.subtreeCpuPercent(loop, [4]), 5);
  });

  it("caps at 100 and rounds to one decimal", () => {
    assert.equal(tree.subtreeCpuPercent([p(1, 0, "a", 70), p(2, 1, "b", 60)], [1]), 100);
    assert.equal(tree.subtreeCpuPercent([p(1, 0, "a", 0.12), p(2, 1, "b", 0.15)], [1]), 0.3);
  });
});
