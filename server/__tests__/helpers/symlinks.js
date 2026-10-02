/**
 * @file Detects whether this machine lets the test process create symbolic links.
 * Windows refuses them (EPERM) unless Developer Mode is on or the process is elevated;
 * symlink-dependent tests skip there with an explicit reason instead of failing.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function detectSymlinkSupport() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "symlink-probe-"));
  try {
    fs.writeFileSync(path.join(dir, "target"), "");
    fs.symlinkSync(path.join(dir, "target"), path.join(dir, "file-link"), "file");
    fs.mkdirSync(path.join(dir, "target-dir"));
    fs.symlinkSync(path.join(dir, "target-dir"), path.join(dir, "dir-link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CAN_SYMLINK = detectSymlinkSupport();

/** `node:test` option: skip when symbolic links cannot be created here. */
const symlinkSkip = {
  skip: CAN_SYMLINK
    ? false
    : "symbolic links are not permitted here (Windows needs Developer Mode or elevation)",
};

module.exports = { CAN_SYMLINK, symlinkSkip };
