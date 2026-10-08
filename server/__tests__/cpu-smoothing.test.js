/**
 * @file Tests for server/lib/cpu-smoothing.js: moving average of the claude total and
 * per-session readings over the last snapshots, sessions averaged over the snapshots
 * that measured them and dropped once gone, and reset.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createCpuSmoother } = require("../lib/cpu-smoothing");

describe("createCpuSmoother", () => {
  it("averages the total over the last snapshots only", () => {
    const smoother = createCpuSmoother(4);
    const totals = [0, 0, 80, 0, 4].map((total) => smoother.push({ total, bySession: {} }).total);
    assert.deepEqual(totals, [0, 0, 26.7, 20, 21]); // last: (0 + 80 + 0 + 4) / 4
  });

  it("averages each session over the snapshots that measured it", () => {
    const smoother = createCpuSmoother(4);
    smoother.push({ total: 10, bySession: { a: 10 } });
    smoother.push({ total: 12, bySession: { a: 6, b: 6 } });
    const out = smoother.push({ total: 2, bySession: { a: 2, b: 0 } });
    assert.deepEqual(out.bySession, { a: 6, b: 3 });
  });

  it("drops a session missing from the latest snapshot", () => {
    const smoother = createCpuSmoother(4);
    smoother.push({ total: 5, bySession: { a: 5 } });
    assert.deepEqual(smoother.push({ total: 0, bySession: {} }).bySession, {});
  });

  it("starts over after clear", () => {
    const smoother = createCpuSmoother(4);
    smoother.push({ total: 90, bySession: {} });
    smoother.clear();
    assert.equal(smoother.push({ total: 2, bySession: {} }).total, 2);
  });
});
