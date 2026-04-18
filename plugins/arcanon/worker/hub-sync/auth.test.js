import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveCredentials, storeCredentials, hasCredentials, AuthError, DEFAULT_HUB_URL } from "./auth.js";

function withTempHome(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-auth-"));
  const originalHome = os.homedir;
  const originalEnvHome = process.env.HOME;
  process.env.HOME = tmp;
  os.homedir = () => tmp;
  try {
    return fn(tmp);
  } finally {
    os.homedir = originalHome;
    if (originalEnvHome !== undefined) process.env.HOME = originalEnvHome;
    else delete process.env.HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function clearEnv() {
  delete process.env.ARCANON_API_KEY;
  delete process.env.ARCANON_API_TOKEN;
  delete process.env.ARCANON_HUB_URL;
}

test("resolveCredentials throws when nothing is configured", () => {
  withTempHome(() => {
    clearEnv();
    assert.throws(() => resolveCredentials(), AuthError);
  });
});

test("resolveCredentials honors explicit apiKey", () => {
  withTempHome(() => {
    clearEnv();
    const { apiKey, hubUrl, source } = resolveCredentials({ apiKey: "arc_explicit" });
    assert.equal(apiKey, "arc_explicit");
    assert.equal(source, "explicit");
    assert.equal(hubUrl, DEFAULT_HUB_URL);
  });
});

test("resolveCredentials reads ARCANON_API_KEY env var", () => {
  withTempHome(() => {
    clearEnv();
    process.env.ARCANON_API_KEY = "arc_env";
    const { apiKey, source } = resolveCredentials();
    assert.equal(apiKey, "arc_env");
    assert.equal(source, "env");
  });
});

test("resolveCredentials falls back to ~/.arcanon/config.json", () => {
  withTempHome((home) => {
    clearEnv();
    const dir = path.join(home, ".arcanon");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ api_key: "arc_home" }));
    const { apiKey, source } = resolveCredentials();
    assert.equal(apiKey, "arc_home");
    assert.equal(source, "home-config");
  });
});

test("resolveCredentials supports legacy ~/.ligamen/config.json", () => {
  withTempHome((home) => {
    clearEnv();
    const dir = path.join(home, ".ligamen");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ api_key: "arc_legacy" }));
    const { apiKey, source } = resolveCredentials();
    assert.equal(apiKey, "arc_legacy");
    assert.equal(source, "home-config");
  });
});

test("resolveCredentials rejects keys without arc_ prefix", () => {
  withTempHome(() => {
    clearEnv();
    assert.throws(
      () => resolveCredentials({ apiKey: "ey.not.a.jwt.but.wrong.prefix" }),
      /must start with "arc_"/,
    );
  });
});

test("storeCredentials writes an 0600 config file and round-trips", () => {
  withTempHome((home) => {
    clearEnv();
    const file = storeCredentials("arc_stored", { hubUrl: "https://api.arcanon.test" });
    assert.ok(file.startsWith(home));
    const stat = fs.statSync(file);
    // On POSIX, check permissions are 0600; skip on Windows.
    if (process.platform !== "win32") {
      assert.equal(stat.mode & 0o777, 0o600);
    }
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(content.api_key, "arc_stored");
    assert.equal(content.hub_url, "https://api.arcanon.test");

    const { apiKey, hubUrl } = resolveCredentials();
    assert.equal(apiKey, "arc_stored");
    assert.equal(hubUrl, "https://api.arcanon.test");
  });
});

test("storeCredentials rejects keys without arc_ prefix", () => {
  withTempHome(() => {
    assert.throws(() => storeCredentials("bogus"), AuthError);
  });
});

test("hasCredentials returns false when nothing is configured", () => {
  withTempHome(() => {
    clearEnv();
    assert.equal(hasCredentials(), false);
  });
});

test("hasCredentials returns true when env var is set", () => {
  withTempHome(() => {
    clearEnv();
    process.env.ARCANON_API_KEY = "arc_env";
    assert.equal(hasCredentials(), true);
  });
});

test("hasCredentials returns true after storeCredentials (regression: auto-upload gate)", () => {
  // This guards the scan-manager auto-upload path: a user who ran
  // /arcanon:login but never exported ARCANON_API_KEY must still be
  // treated as authenticated.
  withTempHome(() => {
    clearEnv();
    storeCredentials("arc_fromlogin");
    assert.equal(hasCredentials(), true);
  });
});
