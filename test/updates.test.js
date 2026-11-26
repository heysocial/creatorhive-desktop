"use strict";
// node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const updates = require("../src/main/updates");

test("an older Mac (2.0.60 to 2.0.68) is sent straight to the latest", () => {
  for (let patch = 60; patch <= 68; patch += 1) {
    assert.equal(updates.versionToFetch("2.0.70", { current: `2.0.${patch}` }), "2.0.70");
  }
});

test("a release that came out while one was ready replaces it (bug 0c2e2820: 2.0.67 offered with 2.0.69 out)", () => {
  assert.equal(updates.versionToFetch("2.0.69", { current: "2.0.66", ready: "2.0.67" }), "2.0.69");
  assert.equal(updates.versionToFetch("2.0.67", { current: "2.0.66", ready: "2.0.67" }), null);
});

test("nothing to fetch when up to date, or when the feed can't be read", () => {
  assert.equal(updates.versionToFetch("2.0.70", { current: "2.0.70" }), null);
  assert.equal(updates.versionToFetch("2.0.69", { current: "2.0.70" }), null);
  assert.equal(updates.versionToFetch(null, { current: "2.0.66" }), null);
});

test("a version given up on isn't fetched again, a newer one is", () => {
  assert.equal(updates.versionToFetch("2.0.67", { current: "2.0.66", gaveUp: "2.0.67" }), null);
  assert.equal(updates.versionToFetch("2.0.70", { current: "2.0.66", gaveUp: "2.0.67" }), "2.0.70");
});

test("install outcome", () => {
  assert.equal(updates.installOutcome(null, "2.0.66"), "none");
  assert.equal(updates.installOutcome({ version: "2.0.67" }, "2.0.66"), "failed");
  assert.equal(updates.installOutcome({ version: "2.0.67" }, "2.0.67"), "installed");
  assert.equal(updates.installOutcome({ version: "2.0.67" }, "2.0.69"), "installed");
});

test("logTail keeps whole lines from the end", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "updates-test-"));
  const file = path.join(dir, "ShipIt_stderr.log");
  assert.equal(updates.logTail(file), null);
  fs.writeFileSync(file, Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") + "\n");
  const tail = updates.logTail(file, 100);
  assert.ok(tail.length <= 100);
  assert.ok(tail.startsWith("line "));
  assert.ok(tail.endsWith("line 199\n"));
  fs.rmSync(dir, { recursive: true, force: true });
});
