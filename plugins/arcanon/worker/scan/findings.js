/**
 * worker/scan/findings.js — Backward-compat re-export shim.
 *
 * The canonical findings contract now lives in contract.js. This shim ensures
 * all existing importers (manager.js, query-engine.js, test files, etc.) keep
 * resolving their imports without change.
 *
 * DO NOT add new logic here. All finding validation, parsing, and constant
 * definitions belong in contract.js.
 */
export * from "./contract.js";
