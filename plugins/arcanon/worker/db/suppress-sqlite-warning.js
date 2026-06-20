// worker/db/suppress-sqlite-warning.js
//
// Side-effect module: silence node:sqlite's ExperimentalWarning.
//
// node:sqlite is experimental until Node 25.7 and emits
//   "SQLite is an experimental feature and might change at any time"
// to stderr the first time it is loaded. We deliberately depend on node:sqlite,
// so for us this warning is pure noise — and worse, it corrupts output: CLI
// commands emit machine-readable JSON on stdout, and callers / test harnesses
// (and bats `run`) frequently merge stderr into that stream, so the warning text
// makes the JSON unparseable.
//
// This must be imported BEFORE `node:sqlite` anywhere the adapter is loaded, so
// it is the first import in sqlite-adapter.js (the single node:sqlite boundary).
// We filter ONLY the SQLite ExperimentalWarning; every other warning (including
// other ExperimentalWarnings and all deprecation/security warnings) passes
// through unchanged.

const original = process.emitWarning.bind(process);

process.emitWarning = (warning, ...args) => {
  const opts = args[0];
  const type = typeof opts === "string" ? opts : opts && opts.type;
  const msg = typeof warning === "string" ? warning : warning && warning.message;
  if (type === "ExperimentalWarning" && /SQLite/i.test(msg || "")) return;
  return original(warning, ...args);
};
