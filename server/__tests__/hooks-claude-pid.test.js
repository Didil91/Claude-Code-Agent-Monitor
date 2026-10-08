/**
 * @file Tests that POST /api/hooks/event links a session to the `claude_pid` the hook
 * handler forwards (shared session-process registry), ignores a missing or invalid
 * PID, and never lets a PID break or reject hook ingestion.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TMP = path.join(os.tmpdir(), `hooks-claude-pid-${Date.now()}-${process.pid}`);
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.CLAUDE_HOME = path.join(TMP, "home");
process.env.DASHBOARD_DATA_DIR = path.join(TMP, "data");
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const { sessionProcesses } = require("../lib/session-processes");

let server;
let base;

async function postHook(body) {
  const res = await fetch(`${base}/api/hooks/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

const claudeItems = (pid) => [{ pid, parentPid: 1, name: "claude", cpuPercent: 3 }];

before(async () => {
  server = await startServer(createApp(), 0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => sessionProcesses.clear());

describe("POST /api/hooks/event with claude_pid", () => {
  it("links the session to its claude process", async () => {
    const status = await postHook({
      hook_type: "PreToolUse",
      data: { session_id: "pid-session", tool_name: "Bash" },
      claude_pid: 4242,
    });
    assert.equal(status, 200);
    assert.deepEqual(sessionProcesses.cpuBySession(claudeItems(4242)), { "pid-session": 3 });
  });

  it("accepts hooks without a PID or with an invalid one, linking nothing", async () => {
    assert.equal(await postHook({ hook_type: "Stop", data: { session_id: "no-pid" } }), 200);
    assert.equal(
      await postHook({ hook_type: "Stop", data: { session_id: "bad-pid" }, claude_pid: "x" }),
      200
    );
    assert.equal(sessionProcesses.size, 0);
  });
});
