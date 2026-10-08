/**
 * @file Tests for server/lib/session-processes.js: recording session → claude PID
 * links (validation, one session per PID), per-session CPU from a process list, and
 * pruning of links whose process is gone or recycled once past the grace period.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createSessionProcessRegistry } = require("../lib/session-processes");

const p = (pid, parentPid, name, cpuPercent) => ({ pid, parentPid, name, cpuPercent });

function setup() {
  let clock = 100_000;
  const registry = createSessionProcessRegistry({ now: () => clock, graceMs: 10_000 });
  return { registry, advance: (ms) => (clock += ms) };
}

const items = [
  p(10, 1, "claude", 1),
  p(11, 10, "bash", 0),
  p(12, 11, "node", 20),
  p(20, 1, "claude.exe", 2),
];

describe("session process registry", () => {
  it("ignores invalid session ids and PIDs", () => {
    const { registry } = setup();
    assert.equal(registry.record("", 10), false);
    assert.equal(registry.record("s1", null), false);
    assert.equal(registry.record("s1", "10"), false);
    assert.equal(registry.record("s1", 0), false);
    assert.equal(registry.record("s1", 1.5), false);
    assert.equal(registry.size, 0);
  });

  it("reports each linked session's process subtree", () => {
    const { registry } = setup();
    registry.record("s1", 10);
    registry.record("s2", 20);
    assert.deepEqual(registry.cpuBySession(items), { s1: 21, s2: 2 });
  });

  it("moves a PID to the latest session that reported it", () => {
    const { registry } = setup();
    registry.record("before-clear", 10);
    registry.record("after-clear", 10);
    assert.deepEqual(registry.cpuBySession(items), { "after-clear": 21 });
    assert.equal(registry.size, 1);
  });

  it("keeps a fresh link whose process is not in the snapshot yet", () => {
    const { registry, advance } = setup();
    registry.record("s1", 99);
    advance(5_000);
    assert.deepEqual(registry.cpuBySession(items), {});
    assert.equal(registry.size, 1);
  });

  it("drops a link once its process is gone past the grace period", () => {
    const { registry, advance } = setup();
    registry.record("s1", 99);
    advance(10_001);
    assert.deepEqual(registry.cpuBySession(items), {});
    assert.equal(registry.size, 0);
  });

  it("drops a link whose PID was recycled by another program", () => {
    const { registry, advance } = setup();
    registry.record("s1", 12); // now a node process, not claude
    advance(10_001);
    assert.deepEqual(registry.cpuBySession(items), {});
    assert.equal(registry.size, 0);
  });
});
