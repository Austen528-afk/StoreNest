"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { formatActivityTime } = require("../overview-dashboard.js");

test("historical Overview activity timestamps include both date and time", () => {
  const label = formatActivityTime("2026-10-01T12:00:00.000Z");
  assert.match(label, /2026/);
  assert.match(label, /Oct/);
  assert.ok(label.includes(":"));
});
