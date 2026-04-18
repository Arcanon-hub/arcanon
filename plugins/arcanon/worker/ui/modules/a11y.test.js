import test from "node:test";
import assert from "node:assert/strict";

// Minimal DOM shim — node:test has no jsdom, but announce() only touches
// document.getElementById and Element.textContent.
function installDomShim() {
  const store = { text: "" };
  const region = {
    id: "a11y-live-polite",
    _text: "",
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; store.text = v; },
  };
  globalThis.document = {
    getElementById: (id) => (id === "a11y-live-polite" ? region : null),
  };
  globalThis.setTimeout = (fn) => { fn(); return 0; };
  globalThis.clearTimeout = () => {};
  return store;
}

test("announce writes the message to #a11y-live-polite", async () => {
  const store = installDomShim();
  const { announce } = await import("./a11y.js");
  announce("scan complete");
  assert.equal(store.text, "scan complete");
});

test("announce drops duplicate consecutive messages", async () => {
  const store = installDomShim();
  const { announce } = await import("./a11y.js");
  announce("scan complete");
  store.text = "CLEARED";
  announce("scan complete"); // duplicate — should be ignored
  assert.equal(store.text, "CLEARED");
});

test("announce no-ops when the live region is absent", async () => {
  globalThis.document = { getElementById: () => null };
  globalThis.setTimeout = (fn) => { fn(); return 0; };
  globalThis.clearTimeout = () => {};
  const { announce } = await import("./a11y.js");
  // Should not throw.
  announce("nothing to hear");
  assert.ok(true);
});
