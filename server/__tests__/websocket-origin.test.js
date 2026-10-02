/**
 * @file Tests that the WebSocket endpoint refuses browser connections from
 * non-loopback origins (cross-site WebSocket hijacking) while keeping the
 * dashboard's own origin and non-browser clients working.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const WebSocket = require("ws");
const sec = require("../lib/security");
const { initWebSocket } = require("../websocket");

describe("isOriginAllowed", () => {
  it("allows missing origins (non-browser clients) and loopback origins", () => {
    assert.equal(sec.isOriginAllowed(undefined), true);
    assert.equal(sec.isOriginAllowed("http://127.0.0.1:4820"), true);
    assert.equal(sec.isOriginAllowed("http://localhost:5173"), true);
  });

  it("refuses foreign, opaque and malformed origins", () => {
    assert.equal(sec.isOriginAllowed("https://evil.example"), false);
    assert.equal(sec.isOriginAllowed("null"), false);
    assert.equal(sec.isOriginAllowed("file://"), false);
    assert.equal(sec.isOriginAllowed("not a url"), false);
  });
});

describe("WebSocket origin check", () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer();
    initWebSocket(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function connect(origin) {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
      ws.on("error", () => resolve("error"));
    });
  }

  it("refuses a connection from a foreign website", async () => {
    assert.equal(await connect("https://evil.example"), 403);
  });

  it("accepts the dashboard origin and clients without an origin", async () => {
    assert.equal(await connect(`http://127.0.0.1:${port}`), "open");
    assert.equal(await connect(undefined), "open");
  });
});
