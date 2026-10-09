/**
 * @file Regression: SubagentStop must close the subagent Claude Code actually
 * stopped, identified by its `agent_id`, and nothing else. Claude Code fires
 * extra SubagentStop events for internal helper agents (empty `agent_type`,
 * an `agent_id` that matches no spawned subagent). Before the fix these fell
 * through to an "oldest working subagent" fallback, so every one of them closed
 * a still-running background subagent: four ~10-minute agents showed as
 * completed after a few seconds. These tests replay that scenario plus the
 * synchronous-subagent and legacy (no agent_id) paths.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), `subagent-stop-${process.pid}-`));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const { db } = require("../db");

let server;
let BASE;

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

const hook = (hook_type, data) =>
  request("/api/hooks/event", { method: "POST", body: { hook_type, data } });
const subagentsOf = async (sid) =>
  (await request(`/api/agents?session_id=${sid}`)).body.agents.filter((a) => a.type === "subagent");
const byName = (agents, name) => agents.find((a) => a.name === name);

/** Spawn an Agent tool call the way Claude Code reports it (Pre then Post). */
async function spawn(sid, { description, prompt, toolUseId, agentId, async = true }) {
  const tool_input = {
    description,
    prompt,
    subagent_type: "general-purpose",
    ...(async ? { run_in_background: true } : {}),
  };
  await hook("PreToolUse", {
    session_id: sid,
    tool_name: "Agent",
    tool_use_id: toolUseId,
    tool_input,
  });
  return {
    post: () =>
      hook("PostToolUse", {
        session_id: sid,
        tool_name: "Agent",
        tool_use_id: toolUseId,
        tool_input,
        tool_response: async
          ? {
              isAsync: true,
              status: "async_launched",
              agentId,
              description,
              prompt,
            }
          : {
              status: "completed",
              agentId,
              content: [{ type: "text", text: "done" }],
            },
      }),
  };
}

const internalStop = (sid, agentId, summary) =>
  hook("SubagentStop", {
    session_id: sid,
    agent_id: agentId,
    agent_type: "",
    agent_transcript_path: `/tmp/projects/x/${sid}/subagents/agent-${agentId}.jsonl`,
    last_assistant_message: summary,
    stop_hook_active: false,
  });

const realStop = (sid, agentId) =>
  hook("SubagentStop", {
    session_id: sid,
    agent_id: agentId,
    agent_type: "general-purpose",
    agent_transcript_path: `/tmp/projects/x/${sid}/subagents/agent-${agentId}.jsonl`,
    stop_hook_active: false,
  });

before(async () => {
  server = await startServer(createApp(), 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("SubagentStop matching", () => {
  it("ignores internal SubagentStops and closes only the subagent named by agent_id", async () => {
    const sid = "sas-async-4";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "audit" });

    const specs = [
      ["Figma flows vs frontend", "toolu_1", "ab617c370e73a104f"],
      ["Frontend components architecture", "toolu_2", "a4b3dc35650158377"],
      ["Backend auth last-method audit", "toolu_3", "ac30389aa017ad192"],
      ["Tests and non-regression", "toolu_4", "a7827ebf0798963c3"],
    ];
    // Claude Code emits all four PreToolUse first, then the PostToolUses.
    const spawned = [];
    for (const [description, toolUseId, agentId] of specs) {
      spawned.push(
        await spawn(sid, { description, prompt: `PROMPT ${description}`, toolUseId, agentId })
      );
    }
    for (const s of spawned) await s.post();
    await hook("Stop", { session_id: sid, stop_reason: "end_turn" });

    let subs = await subagentsOf(sid);
    assert.equal(subs.length, 4);
    for (const [description, , agentId] of specs) {
      assert.equal(byName(subs, description).claude_agent_id, agentId);
    }

    // Internal progress-summary agents stop many times while the real ones run.
    for (let i = 0; i < 12; i++) {
      await internalStop(sid, `a${String(i).padStart(16, "0")}`, `Reading file ${i}`);
    }
    subs = await subagentsOf(sid);
    assert.deepEqual(
      subs.map((a) => a.status),
      ["working", "working", "working", "working"],
      "internal SubagentStops must not close any real subagent"
    );

    await realStop(sid, "a4b3dc35650158377");
    subs = await subagentsOf(sid);
    const done = byName(subs, "Frontend components architecture");
    assert.equal(done.status, "completed");
    assert.ok(done.ended_at && done.ended_at >= done.started_at, "ended_at must be set");
    for (const name of [
      "Figma flows vs frontend",
      "Backend auth last-method audit",
      "Tests and non-regression",
    ]) {
      assert.equal(byName(subs, name).status, "working", `${name} must still be working`);
    }

    // A duplicate SubagentStop for an already-completed agent leaves ended_at alone.
    const endedAt = done.ended_at;
    await realStop(sid, "a4b3dc35650158377");
    subs = await subagentsOf(sid);
    assert.equal(byName(subs, "Frontend components architecture").ended_at, endedAt);
    assert.equal(subs.filter((a) => a.status === "completed").length, 1);

    // The internal stops are still recorded as events.
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND event_type = ?")
      .get(sid, "SubagentStop").n;
    assert.equal(n, 14);
  });

  it("matches a synchronous subagent whose SubagentStop arrives before PostToolUse", async () => {
    const sid = "sas-sync";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });

    const s = await spawn(sid, {
      description: "Sync explorer",
      prompt: "explore",
      toolUseId: "toolu_s1",
      agentId: "a1111111111111111",
      async: false,
    });
    // An internal stop while the sync agent runs must not close it.
    await internalStop(sid, "a9999999999999999", "Listing files");
    assert.equal(byName(await subagentsOf(sid), "Sync explorer").status, "working");

    // Synchronous agents stop before their PostToolUse binds agent_id.
    await realStop(sid, "a1111111111111111");
    let sub = byName(await subagentsOf(sid), "Sync explorer");
    assert.equal(sub.status, "completed");
    const endedAt = sub.ended_at;

    // PostToolUse binds the id afterwards without reopening or re-stamping it.
    await s.post();
    sub = byName(await subagentsOf(sid), "Sync explorer");
    assert.equal(sub.status, "completed");
    assert.equal(sub.ended_at, endedAt);
    assert.equal(sub.claude_agent_id, "a1111111111111111");
  });

  it("parses the legacy text tool_response format for agentId", async () => {
    const sid = "sas-legacy-text";
    await hook("SessionStart", { session_id: sid });
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_use_id: "toolu_t1",
      tool_input: { description: "Text agent", prompt: "p", subagent_type: "general-purpose" },
    });
    await hook("PostToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_use_id: "toolu_t1",
      tool_input: { description: "Text agent", prompt: "p", subagent_type: "general-purpose" },
      tool_response: [
        {
          type: "text",
          text: "Async agent launched successfully.\nagentId: a00725f64a8e85406 (internal ID - do not mention to user.)",
        },
      ],
    });
    assert.equal(byName(await subagentsOf(sid), "Text agent").claude_agent_id, "a00725f64a8e85406");
  });

  it("merges a subagent JSONL into the live row bound to its agent id", async () => {
    const { importSubagentFromJsonl } = require("../../scripts/import-history");
    const dbModule = require("../db");
    const sid = "sas-jsonl";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    // Two same-type agents spawned together: start time alone can't tell them apart.
    const a = await spawn(sid, {
      description: "First",
      prompt: "p1",
      toolUseId: "toolu_j1",
      agentId: "a2222222222222222",
    });
    const b = await spawn(sid, {
      description: "Second",
      prompt: "p2",
      toolUseId: "toolu_j2",
      agentId: "a3333333333333333",
    });
    await a.post();
    await b.post();
    const second = byName(await subagentsOf(sid), "Second");

    importSubagentFromJsonl(dbModule, sid, `${sid}-main`, {
      agentId: "a3333333333333333",
      agentType: "general-purpose",
      startedAt: byName(await subagentsOf(sid), "First").started_at,
      endedAt: new Date().toISOString(),
      task: "p2",
      toolEvents: [
        {
          tool_use_id: "toolu_inner",
          tool_name: "Read",
          tool_input: { file_path: "x" },
          pre_timestamp: new Date().toISOString(),
        },
      ],
    });
    const row = db
      .prepare("SELECT agent_id FROM events WHERE session_id = ? AND data LIKE ?")
      .get(sid, '%"tool_use_id":"toolu_inner"%');
    assert.equal(row.agent_id, second.id);
  });

  it("keeps the legacy fallback for payloads without any agent identifier", async () => {
    const sid = "sas-legacy";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: { description: "Old style", prompt: "p" },
    });
    await hook("SubagentStop", { session_id: sid });
    assert.equal(byName(await subagentsOf(sid), "Old style").status, "completed");
  });
});
