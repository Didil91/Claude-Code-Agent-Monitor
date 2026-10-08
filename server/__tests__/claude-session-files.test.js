/**
 * @file Tests for server/lib/claude-session-files.js: reading Claude Code's per-process
 * files (`<claude home>/sessions/<pid>.json`) into PID → session links (malformed,
 * mismatched and non-JSON files skipped; the newest file wins a shared PID; missing
 * directory tolerated) and the periodic sync into the session-process registry.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  readClaudeSessionFiles,
  startClaudeSessionFileSync,
} = require("../lib/claude-session-files");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session-files-"));
const DIR = path.join(TMP, "sessions");

function write(name, content) {
  fs.writeFileSync(
    path.join(DIR, name),
    typeof content === "string" ? content : JSON.stringify(content)
  );
}

before(() => {
  fs.mkdirSync(DIR);
  write("100.json", { pid: 100, sessionId: "s-a", startedAt: 1, cwd: "C:/x" });
  write("200.json", { pid: 200, sessionId: "s-b", startedAt: 2 });
  write("300.json", "{ not json");
  write("400.json", { pid: 999, sessionId: "s-mismatch" }); // pid ≠ file name
  write("500.json", { pid: 500 }); // no session id
  write("600.abc.key", "secret-ish");
  write("notes.txt", "hello");
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("readClaudeSessionFiles", () => {
  it("returns only well-formed PID → session links, oldest first", () => {
    assert.deepEqual(readClaudeSessionFiles(DIR), [
      { pid: 100, sessionId: "s-a", startedAt: 1 },
      { pid: 200, sessionId: "s-b", startedAt: 2 },
    ]);
  });

  it("returns nothing for a missing directory", () => {
    assert.deepEqual(readClaudeSessionFiles(path.join(TMP, "absent")), []);
  });
});

describe("startClaudeSessionFileSync", () => {
  function fakeTimers() {
    const intervals = [];
    return {
      intervals,
      setInterval: (fn, ms) => {
        const handle = { fn, ms, unref() {} };
        intervals.push(handle);
        return handle;
      },
      clearInterval: (handle) => {
        handle.cleared = true;
      },
    };
  }

  it("records every link now and on each interval, until stopped", () => {
    const recorded = [];
    const registry = { record: (sessionId, pid) => recorded.push([sessionId, pid]) };
    const timers = fakeTimers();

    const stop = startClaudeSessionFileSync({ registry, dir: DIR, intervalMs: 30_000, timers });
    assert.deepEqual(recorded, [
      ["s-a", 100],
      ["s-b", 200],
    ]);
    assert.equal(timers.intervals[0].ms, 30_000);

    timers.intervals[0].fn();
    assert.equal(recorded.length, 4);

    stop();
    assert.equal(timers.intervals[0].cleared, true);
  });
});
