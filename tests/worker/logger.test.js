import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createLogger } from "../../worker/lib/logger.js";

// Helper: create a temporary dataDir with logs/ subdirectory
function makeTmpDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "actest-"));
  fs.mkdirSync(path.join(tmp, "logs"));
  return tmp;
}

// Helper: read all log lines from the log file
function readLines(tmp) {
  const content = fs.readFileSync(
    path.join(tmp, "logs", "worker.log"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test("createLogger returns an object with log, info, warn, error, debug methods", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "DEBUG",
      component: "test",
    });
    assert.equal(typeof logger.log, "function");
    assert.equal(typeof logger.info, "function");
    assert.equal(typeof logger.warn, "function");
    assert.equal(typeof logger.error, "function");
    assert.equal(typeof logger.debug, "function");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("log line includes ts, level, msg, pid, port, component fields", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "test-comp",
    });
    logger.info("hello world");
    const lines = readLines(tmp);
    assert.equal(lines.length, 1);
    const line = lines[0];
    assert.ok(line.ts, "Missing ts");
    assert.equal(line.level, "INFO");
    assert.equal(line.msg, "hello world");
    assert.equal(typeof line.pid, "number");
    assert.equal(line.port, 37888);
    assert.equal(line.component, "test-comp");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("DEBUG is suppressed when logLevel is INFO", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "test",
    });
    logger.debug("this should be suppressed");
    logger.info("this should appear");
    const lines = readLines(tmp);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "INFO");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("extra fields are merged into the log line", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "test",
    });
    logger.log("INFO", "msg with extra", { requestId: "abc123", count: 5 });
    const lines = readLines(tmp);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].requestId, "abc123");
    assert.equal(lines[0].count, 5);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("port field is omitted when port is undefined", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: undefined,
      logLevel: "INFO",
      component: "test",
    });
    logger.info("no port");
    const lines = readLines(tmp);
    assert.equal(lines.length, 1);
    assert.ok(!("port" in lines[0]), "port should be omitted when undefined");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("port field is omitted when port is null", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: null,
      logLevel: "INFO",
      component: "test",
    });
    logger.info("no port null");
    const lines = readLines(tmp);
    assert.equal(lines.length, 1);
    assert.ok(!("port" in lines[0]), "port should be omitted when null");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("convenience methods info, warn, error, debug delegate to log", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: 0,
      logLevel: "DEBUG",
      component: "conv",
    });
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");
    logger.debug("debug msg");
    const lines = readLines(tmp);
    assert.equal(lines.length, 4);
    assert.equal(lines[0].level, "INFO");
    assert.equal(lines[1].level, "WARN");
    assert.equal(lines[2].level, "ERROR");
    assert.equal(lines[3].level, "DEBUG");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("LEVELS order: DEBUG < INFO < WARN < ERROR", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "WARN",
      component: "test",
    });
    logger.debug("suppressed");
    logger.info("suppressed");
    logger.warn("appears");
    logger.error("appears");
    const lines = readLines(tmp);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].level, "WARN");
    assert.equal(lines[1].level, "ERROR");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("log file is appended to {dataDir}/logs/worker.log", () => {
  const tmp = makeTmpDir();
  try {
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "file-test",
    });
    logger.info("first");
    logger.info("second");
    const lines = readLines(tmp);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].msg, "first");
    assert.equal(lines[1].msg, "second");
    // Verify it went to the right path
    assert.ok(
      fs.existsSync(path.join(tmp, "logs", "worker.log")),
      "worker.log should exist",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("logLevel defaults to INFO when not provided", () => {
  const tmp = makeTmpDir();
  try {
    // Create without logLevel — should default to INFO
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      component: "default-level",
    });
    logger.debug("suppressed");
    logger.info("appears");
    const lines = readLines(tmp);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "INFO");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});
