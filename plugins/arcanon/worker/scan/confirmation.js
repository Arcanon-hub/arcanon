/**
 * worker/confirmation-flow.js — User confirmation flow module for Ligamen v2.0
 *
 * Pure module: no I/O, no SQLite calls, no console.log.
 * All functions are stateless — caller (Phase 20 command layer) drives the
 * interactive loop and calls db.writeScan() ONLY after this module returns
 * confirmed findings.
 *
 * Design rationale:
 * - HIGH confidence findings are batched into one confirm — avoids rubber-stamping
 *   (PITFALLS.md Pitfall 9: 50+ individual prompts cause users to approve everything)
 * - LOW confidence findings are capped at MAX_LOW_CONFIDENCE to keep the review
 *   session manageable; overflow is stored for a subsequent round
 * - Edit instructions are parsed in a single pass — complex edits are handled by
 *   the Phase 20 interactive loop; this module handles one-shot instruction parsing
 *
 * Exports:
 *   MAX_LOW_CONFIDENCE       — integer cap (10)
 *   NEEDS_REPROMPT           — sentinel returned by applyEdits for unrecognized instructions
 *   AFFIRMATIVE_SYNONYMS     — frozen Set of natural-language affirmatives treated as "confirm"
 *   groupByConfidence        — split findings into high / low / lowOverflow
 *   formatHighConfidenceSummary — formatted string for batch high-confidence review
 *   formatLowConfidenceQuestions — array of per-finding clarifying question strings
 *   applyEdits               — apply user edit instructions to findings array
 *   buildConfirmationPrompt  — assemble full prompt text for Phase 20 to present
 */

/** Maximum number of low-confidence findings shown per confirmation session. */
export const MAX_LOW_CONFIDENCE = 10;

/**
 * Sentinel returned by applyEdits() when the instruction is not recognized.
 * Callers can check: `result === NEEDS_REPROMPT` to detect and re-prompt the user.
 */
export const NEEDS_REPROMPT = Object.freeze({ __type: "NEEDS_REPROMPT" });

/**
 * Frozen Set of natural-language affirmatives that applyEdits() normalizes to "confirm".
 * All values are lowercase — comparison is done via instruction.toLowerCase().
 */
export const AFFIRMATIVE_SYNONYMS = Object.freeze(
  new Set(["sure", "yep", "ok", "accept", "looks good", "sounds good"]),
);

/**
 * Split a findings array by confidence level and cap the low bucket.
 *
 * @param {Array} findings - Array of finding objects from Phase 18 scan-manager.
 * @returns {{ high: Array, low: Array, lowOverflow: Array }}
 */
export function groupByConfidence(findings) {
  const high = [];
  const lowAll = [];

  for (const f of findings) {
    if (
      typeof f.confidence === "string" &&
      f.confidence.toLowerCase() === "high"
    ) {
      high.push(f);
    } else {
      lowAll.push(f);
    }
  }

  const low = lowAll.slice(0, MAX_LOW_CONFIDENCE);
  const lowOverflow = lowAll.slice(MAX_LOW_CONFIDENCE);

  return { high, low, lowOverflow };
}

/**
 * Format a human-readable summary of high-confidence findings grouped by repo.
 *
 * @param {Array} highFindings - High-confidence findings (already grouped).
 * @returns {string} Formatted summary string, or empty string if input is empty.
 */
export function formatHighConfidenceSummary(highFindings) {
  if (highFindings.length === 0) return "";

  const totalConns = highFindings.reduce(
    (sum, f) => sum + f.connections.length,
    0,
  );

  // Group findings by repo path
  const repoMap = new Map();
  for (const f of highFindings) {
    const key = f.repo;
    if (!repoMap.has(key)) repoMap.set(key, []);
    repoMap.get(key).push(f);
  }

  const lines = [
    `--- High confidence findings (${totalConns} connection${totalConns !== 1 ? "s" : ""} across ${highFindings.length} service${highFindings.length !== 1 ? "s" : ""}) ---`,
  ];

  for (const [repoPath, repoFindings] of repoMap) {
    lines.push(`[repo: ${repoPath}]`);
    for (const f of repoFindings) {
      for (const conn of f.connections) {
        lines.push(
          `  ${conn.sourceService} ${conn.method} ${conn.path} (${conn.protocol})`,
        );
      }
    }
  }

  lines.push(
    `\nType 'confirm' to accept all high-confidence findings, or describe changes.`,
  );

  return lines.join("\n");
}

/**
 * Format clarifying question strings for each low-confidence finding.
 *
 * @param {Array} lowFindings - Low-confidence findings (already capped).
 * @returns {string[]} One question string per finding.
 */
export function formatLowConfidenceQuestions(lowFindings) {
  return lowFindings.map((f) => {
    const conn = f.connections[0] || {};
    const source = conn.sourceService || "(unknown source)";
    const target = conn.targetService || f.service || "(unknown target)";
    const method = conn.method || "";
    const path = conn.path || "";
    const evidence = conn.sourceFile || "(unknown file)";
    const protocol = conn.protocol ? ` via ${conn.protocol}` : "";

    return [
      `Possible connection: ${source} → ${target}${method ? ` via ${method} ${path}` : ""}${protocol}`,
      `  Evidence: ${evidence}`,
      `  Question: Is ${source} intentionally calling ${target}'s ${method} ${path}?`,
      `  Type "yes", "no", or describe the correct connection.`,
    ].join("\n");
  });
}

/**
 * Apply user-provided edit instructions to a findings array.
 *
 * Supported instructions:
 *   - "confirm" or "" (empty)           → no-op, return findings unchanged
 *   - Any value in AFFIRMATIVE_SYNONYMS → treated as "confirm", return findings unchanged
 *   - "remove {serviceName}"            → remove findings where finding.service matches (case-insensitive)
 *   - "remove connection {src} -> {tgt}"→ remove matching connection objects within findings
 *
 * Unrecognized instructions: return NEEDS_REPROMPT sentinel (callers re-prompt the user).
 *
 * @param {Array} findings - Current findings array.
 * @param {string} editInstructions - Free-text edit instruction from the user.
 * @returns {Array|typeof NEEDS_REPROMPT} Modified (or unchanged) findings array, or NEEDS_REPROMPT.
 */
export function applyEdits(findings, editInstructions) {
  const instruction = (editInstructions || "").trim();

  // No-op cases: empty string and explicit "confirm"
  if (instruction === "" || instruction.toLowerCase() === "confirm") {
    return findings;
  }

  // Natural-language affirmatives treated as "confirm"
  if (AFFIRMATIVE_SYNONYMS.has(instruction.toLowerCase())) {
    return findings;
  }

  // "remove connection {source} -> {target}"
  const removeConnMatch = instruction.match(
    /^remove\s+connection\s+(.+?)\s*->\s*(.+)$/i,
  );
  if (removeConnMatch) {
    const srcName = removeConnMatch[1].trim().toLowerCase();
    const tgtName = removeConnMatch[2].trim().toLowerCase();

    return findings
      .map((f) => {
        const filtered = f.connections.filter(
          (c) =>
            !(
              (c.sourceService || "").toLowerCase() === srcName &&
              (c.targetService || "").toLowerCase() === tgtName
            ),
        );
        // If all connections removed and this was the only connection source, drop finding
        if (filtered.length === 0 && f.connections.length > 0) return null;
        return { ...f, connections: filtered };
      })
      .filter(Boolean);
  }

  // "remove {serviceName}"
  const removeServiceMatch = instruction.match(/^remove\s+(.+)$/i);
  if (removeServiceMatch) {
    const serviceName = removeServiceMatch[1].trim().toLowerCase();
    return findings.filter(
      (f) => (f.service || "").toLowerCase() !== serviceName,
    );
  }

  // Unrecognized instruction — return sentinel so callers can re-prompt the user
  return NEEDS_REPROMPT;
}

/**
 * Assemble the full confirmation prompt text.
 *
 * @param {{ high: Array, low: Array, lowOverflow: Array, highSummary: string, lowQuestions: string[] }} grouped
 *   - highSummary: result of formatHighConfidenceSummary(grouped.high)
 *   - lowQuestions: result of formatLowConfidenceQuestions(grouped.low)
 * @returns {string} Full prompt text to present to the user.
 */
export function buildConfirmationPrompt(grouped) {
  const parts = [];

  if (grouped.highSummary) {
    parts.push(grouped.highSummary);
  }

  if (grouped.lowQuestions && grouped.lowQuestions.length > 0) {
    grouped.lowQuestions.forEach((q, i) => {
      parts.push(
        `\n--- Low confidence finding ${i + 1} of ${grouped.low.length} ---\n${q}`,
      );
    });
  }

  if (grouped.lowOverflow && grouped.lowOverflow.length > 0) {
    parts.push(
      `\n[Note: ${grouped.lowOverflow.length} additional low-confidence connections found — they will be presented after you confirm or skip the above.]`,
    );
  }

  return parts.join("\n");
}
