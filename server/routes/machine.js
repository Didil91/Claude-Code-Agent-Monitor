/**
 * @file GET /api/machine — returns the host PC metrics rolling window (last 5 minutes of
 * CPU / RAM / disk / system volume / GPU samples), the latest top-process snapshot and the
 * sensor status, as collected by `server/lib/machine-metrics.js`. Read-only; live updates
 * arrive over the WebSocket as `machine.sample`.
 */

const { Router } = require("express");
const { getMachineSnapshot } = require("../lib/machine-metrics");

const router = Router();

router.get("/", (_req, res) => {
  res.json(getMachineSnapshot());
});

module.exports = router;
