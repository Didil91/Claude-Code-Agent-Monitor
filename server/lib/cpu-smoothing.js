/**
 * @file Moving average of the claude CPU readings taken at each process snapshot: the
 * machine-wide "claude + its commands" total and each session's share. Claude works in
 * bursts (a command spikes for a few seconds, then it waits on the API), so a single
 * snapshot every 5 s mostly lands on either a spike or a lull. Every view — Machine
 * tile, its curve, the session tags — shows this one smoothed value, so they agree.
 * No I/O.
 */

/** Snapshots averaged (one every 5 s on Windows → ~20 s). */
const DEFAULT_SMOOTHING_SNAPSHOTS = 4;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * @param {number} [size] snapshots kept
 * @returns {{ push(reading: {total:number, bySession:Record<string, number>}):
 *   {total:number, bySession:Record<string, number>}, clear(): void }}
 */
function createCpuSmoother(size = DEFAULT_SMOOTHING_SNAPSHOTS) {
  const readings = [];
  return {
    /**
     * Add one snapshot's readings and return the averages over the last `size`
     * snapshots. A session is averaged over the snapshots where it was measured and
     * dropped as soon as the latest snapshot no longer has it (process gone).
     */
    push(reading) {
      readings.push(reading);
      if (readings.length > size) readings.shift();
      const bySession = {};
      for (const sessionId of Object.keys(reading.bySession)) {
        const values = readings
          .map((r) => r.bySession[sessionId])
          .filter((v) => Number.isFinite(v));
        bySession[sessionId] = round1(average(values));
      }
      return { total: round1(average(readings.map((r) => r.total))), bySession };
    },
    clear() {
      readings.length = 0;
    },
  };
}

module.exports = { DEFAULT_SMOOTHING_SNAPSHOTS, createCpuSmoother };
