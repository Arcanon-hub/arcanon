import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createLogger } from "../../plugins/arcanon/worker/lib/logger.js";

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

// LOG-01: rotation tests

test("rotates when file exceeds 10 MB threshold", () => {
  const tmp = makeTmpDir();
  try {
    const logPath = path.join(tmp, "logs", "worker.log");
    // Write a fake 10 MB + 1 byte stub
    fs.writeFileSync(logPath, Buffer.alloc(10 * 1024 * 1024 + 1));
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "rotation-test",
    });
    logger.info("trigger rotation");
    // worker.log should be small (just the new line)
    const newSize = fs.statSync(logPath).size;
    assert.ok(newSize < 1024, `worker.log should be small after rotation, got ${newSize} bytes`);
    // worker.log.1 must exist and contain the old large content
    const rotated = path.join(tmp, "logs", "worker.log.1");
    assert.ok(fs.existsSync(rotated), "worker.log.1 should exist after rotation");
    const rotatedSize = fs.statSync(rotated).size;
    assert.ok(rotatedSize >= 10 * 1024 * 1024, "worker.log.1 should contain the old large content");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("rotation keeps at most 3 rotated files — deletes worker.log.4", () => {
  const tmp = makeTmpDir();
  try {
    const logsDir = path.join(tmp, "logs");
    const logPath = path.join(logsDir, "worker.log");
    // Pre-create worker.log (>= 10 MB stub) and rotated files
    fs.writeFileSync(logPath, Buffer.alloc(10 * 1024 * 1024 + 1));
    fs.writeFileSync(path.join(logsDir, "worker.log.1"), "rotated-1");
    fs.writeFileSync(path.join(logsDir, "worker.log.2"), "rotated-2");
    fs.writeFileSync(path.join(logsDir, "worker.log.3"), "rotated-3");
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "rotation-test",
    });
    logger.info("trigger");
    // .1, .2, .3 must exist
    assert.ok(fs.existsSync(path.join(logsDir, "worker.log.1")), "worker.log.1 should exist");
    assert.ok(fs.existsSync(path.join(logsDir, "worker.log.2")), "worker.log.2 should exist");
    assert.ok(fs.existsSync(path.join(logsDir, "worker.log.3")), "worker.log.3 should exist");
    // .4 must NOT exist
    assert.ok(!fs.existsSync(path.join(logsDir, "worker.log.4")), "worker.log.4 should NOT exist");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test("does not rotate when file is below 10 MB", () => {
  const tmp = makeTmpDir();
  try {
    const logPath = path.join(tmp, "logs", "worker.log");
    // Write a small file (below 10 MB threshold) — include newline so it forms its own line
    fs.writeFileSync(logPath, "x\n");
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "no-rotation-test",
    });
    logger.info("no rotation");
    // worker.log should contain 2 lines (the 1 byte + the new line)
    const content = fs.readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    assert.equal(lines.length, 2, `Expected 2 lines, got ${lines.length}`);
    // worker.log.1 must NOT exist
    assert.ok(!fs.existsSync(path.join(tmp, "logs", "worker.log.1")), "worker.log.1 should NOT exist");
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

// LOG-02: TTY-aware stderr tests

test("skips stderr write when process.stderr.isTTY is falsy", () => {
  const tmp = makeTmpDir();
  const originalIsTTY = process.stderr.isTTY;
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderrCallCount = 0;
  try {
    process.stderr.isTTY = undefined;
    process.stderr.write = (data, ...args) => {
      stderrCallCount++;
      return originalWrite(data, ...args);
    };
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "tty-test",
    });
    logger.info("daemon");
    assert.equal(stderrCallCount, 0, "stderr.write should NOT be called when isTTY is falsy");
    // Log file must still contain the line
    const lines = readLines(tmp);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].msg, "daemon");
  } finally {
    process.stderr.isTTY = originalIsTTY;
    process.stderr.write = originalWrite;
    fs.rmSync(tmp, { recursive: true });
  }
});

test("writes to stderr when process.stderr.isTTY is truthy", () => {
  const tmp = makeTmpDir();
  const originalIsTTY = process.stderr.isTTY;
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderrCallCount = 0;
  let stderrLastArg = null;
  try {
    process.stderr.isTTY = true;
    process.stderr.write = (data, ...args) => {
      stderrCallCount++;
      stderrLastArg = data;
      return originalWrite(data, ...args);
    };
    const logger = createLogger({
      dataDir: tmp,
      port: 37888,
      logLevel: "INFO",
      component: "tty-test",
    });
    logger.info("interactive");
    assert.equal(stderrCallCount, 1, "stderr.write should be called exactly once when isTTY is truthy");
    assert.ok(stderrLastArg && stderrLastArg.includes("interactive"), "stderr should contain the JSON line");
  } finally {
    process.stderr.isTTY = originalIsTTY;
    process.stderr.write = originalWrite;
    fs.rmSync(tmp, { recursive: true });
  }
});
