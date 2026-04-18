import test from "node:test";
import assert from "node:assert/strict";

import { panelModeForWidth } from "./detail-panel.js";

test("panelModeForWidth returns 'drawer' at or below 900px", () => {
  assert.equal(panelModeForWidth(320), "drawer");
  assert.equal(panelModeForWidth(600), "drawer");
  assert.equal(panelModeForWidth(900), "drawer");
});

test("panelModeForWidth returns 'side' above 900px", () => {
  assert.equal(panelModeForWidth(901), "side");
  assert.equal(panelModeForWidth(1440), "side");
  assert.equal(panelModeForWidth(1920), "side");
});

test("panelModeForWidth defaults to side when input is not numeric", () => {
  assert.equal(panelModeForWidth(undefined), "side");
  assert.equal(panelModeForWidth("900"), "side");
});
