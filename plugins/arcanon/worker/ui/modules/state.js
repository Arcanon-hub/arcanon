/**
 * Shared graph state — single source of truth for all UI modules.
 */

import { CANONICAL_PROTOCOLS } from "./protocol.js";

/**
 * The protocol render buckets the UI draws + toggles by default. Derived from
 * the shared CANONICAL_PROTOCOLS source of truth (NOT a hand-written literal —
 * that independent divergence was the original #42 bug) by intersecting against
 * the rendered-bucket list. The infra-only buckets (k8s/tf/helm/import) are
 * excluded from the DEFAULT-on protocol checkboxes here; db and other MUST be
 * default-on so datastore edges get their own filter and unknown protocols are
 * rendered (greyed) rather than silently dropped.
 *
 * @type {string[]}
 */
const RENDER_BUCKETS = ["rest", "grpc", "events", "db", "internal", "sdk", "other"].filter(
  (b) => CANONICAL_PROTOCOLS.has(b),
);

export const state = {
  graphData: { nodes: [], edges: [], mismatches: [], actors: [] },
  positions: {},
  boundaryBoxes: [],
  selectedNodeId: null,
  blastNodeId: null,
  blastSet: new Set(),
  blastCache: {},
  isolatedNodeId: null,   // number|null — ID of node in isolation mode, or null when off
  isolationDepth: 1,      // number — hop depth (1, 2, or 3)
  activeProtocols: new Set(RENDER_BUCKETS),
  activeLayers: new Set(["services", "libraries", "infra", "external"]),
  mismatchesOnly: false,
  hideIsolated: false,
  boundaryFilter: null,      // string boundary name or null (All)
  languageFilter: null,      // string language name or null (All)
  filterPanelOpen: false,
  searchFilter: "",
  currentProject: null,   // hash of currently loaded project
  latestScanVersionId: null,   // ID of the most recent scan (from /graph response metadata)
  showChanges: true,           // When true, highlight nodes/edges from the latest scan
  isDragging: false,
  dragNodeId: null,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  panStartTransformX: 0,
  panStartTransformY: 0,
  dragStarted: false,
  transform: { x: 0, y: 0, scale: 1 },
  logPanelOpen: false,
  logComponentFilter: "all",   // "all" | "worker" | "http" | "mcp" | "scan"
  logSearchFilter: "",
  logLastSince: null,          // ISO timestamp string — last poll watermark
  edgeBundles: [],             // populated by computeEdgeBundles() after graphData load
};

export const NODE_RADIUS = 18;
export const LABEL_MAX_CHARS = 24;

/**
 * Colors are sourced from the CSS custom properties in styles/tokens.css so
 * light/dark themes Just Work. Defaults below are the dark-mode fallbacks
 * used when tokens aren't available (SSR-ish paths, tests, missing <link>).
 */
const DEFAULTS = {
  canvas:   "#0b0d12",          // background of the drawing surface itself
  boundary: "#63b3ed",          // boundary box fill/stroke/label
  layer:    "#a0aec0",          // layer (services / libraries / infra) container
  badge:    "#1a202c",          // small badge backdrops drawn on top of nodes
  mismatch: "#fc8181",          // edges flagged as schema mismatches
  node: {
    default:  "#4299e1",
    selected: "#f6ad55",
    blast:    "#fc8181",
    dimmed:   "#2d3748",
    new:      "#f6e05e",
  },
  edge: {
    default:  "#4a5568",
    selected: "#f6ad55",
    blast:    "#fc8181",
    dimmed:   "#1a202c",
    new:      "#f6e05e",
  },
  label: {
    default: "#e2e8f0",
    dimmed:  "#4a5568",
  },
  protocol: {
    rest: "#4299e1", grpc: "#68d391", events: "#9f7aea",
    internal: "#4a5568", sdk: "#d69e2e", import: "#d69e2e",
    // db: datastore dependencies get a distinct teal/cyan (not events/amber,
    // not grpc/green). other: muted grey matching the default edge so the
    // catch-all reads as "rendered but unclassified".
    db: "#38b2ac", other: "#718096",
  },
  nodeType: {
    library: "#9f7aea", sdk: "#9f7aea", frontend: "#f6ad55",
    service: "#4299e1", infra: "#68d391", actor: "#e06060",
  },
  // Subtle backgrounds layered behind the node fill — matches
  // arcanon-hub's tint approach. Defaults are the dark-mode values.
  nodeTint: {
    database: "#1e293b",
    broker:   "#292017",
    external: "#1f2937",
    frontend: "#2d2640",
  },
};

export const COLORS = {
  canvas:   DEFAULTS.canvas,
  boundary: DEFAULTS.boundary,
  layer:    DEFAULTS.layer,
  badge:    DEFAULTS.badge,
  mismatch: DEFAULTS.mismatch,
  node:     { ...DEFAULTS.node },
  edge:     { ...DEFAULTS.edge },
  label:    { ...DEFAULTS.label },
};
export const PROTOCOL_COLORS = { ...DEFAULTS.protocol };
export const NODE_TYPE_COLORS = { ...DEFAULTS.nodeType };
export const NODE_TINT_COLORS = { ...DEFAULTS.nodeTint };

function readCssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Re-populate the COLORS / PROTOCOL_COLORS / NODE_TYPE_COLORS tables from the
 * currently-active theme tokens. Callers should invoke once on load and again
 * on each `arcanon:theme` event.
 */
export function refreshColors() {
  // Surfaces drawn directly on the canvas — must follow the theme so the
  // graph background matches the rest of the UI in both light and dark.
  COLORS.canvas    = readCssVar("--color-canvas",            DEFAULTS.canvas);
  COLORS.boundary  = readCssVar("--color-accent",            DEFAULTS.boundary);
  COLORS.layer     = readCssVar("--color-text-secondary",    DEFAULTS.layer);
  COLORS.badge     = readCssVar("--color-surface-elevated",  DEFAULTS.badge);
  COLORS.mismatch  = readCssVar("--color-error",             DEFAULTS.mismatch);

  COLORS.node.default   = readCssVar("--color-node-service",  DEFAULTS.node.default);
  COLORS.node.selected  = readCssVar("--color-node-selected", DEFAULTS.node.selected);
  COLORS.node.blast     = readCssVar("--color-error",         DEFAULTS.node.blast);
  COLORS.node.dimmed    = readCssVar("--color-surface-elevated", DEFAULTS.node.dimmed);
  COLORS.node.new       = readCssVar("--color-edge-change",   DEFAULTS.node.new);

  COLORS.edge.default   = readCssVar("--color-edge-default",  DEFAULTS.edge.default);
  COLORS.edge.selected  = readCssVar("--color-node-selected", DEFAULTS.edge.selected);
  COLORS.edge.blast     = readCssVar("--color-error",         DEFAULTS.edge.blast);
  COLORS.edge.dimmed    = readCssVar("--color-canvas",        DEFAULTS.edge.dimmed);
  COLORS.edge.new       = readCssVar("--color-edge-change",   DEFAULTS.edge.new);

  COLORS.label.default  = readCssVar("--color-text-primary",  DEFAULTS.label.default);
  COLORS.label.dimmed   = readCssVar("--color-text-muted",    DEFAULTS.label.dimmed);

  PROTOCOL_COLORS.rest     = readCssVar("--color-edge-rest",    DEFAULTS.protocol.rest);
  PROTOCOL_COLORS.grpc     = readCssVar("--color-edge-grpc",    DEFAULTS.protocol.grpc);
  PROTOCOL_COLORS.events   = readCssVar("--color-edge-events",  DEFAULTS.protocol.events);
  PROTOCOL_COLORS.db       = readCssVar("--color-edge-db",      DEFAULTS.protocol.db);
  PROTOCOL_COLORS.other    = readCssVar("--color-edge-other",   DEFAULTS.protocol.other);
  PROTOCOL_COLORS.internal = readCssVar("--color-edge-default", DEFAULTS.protocol.internal);

  NODE_TYPE_COLORS.library  = readCssVar("--color-node-library",  DEFAULTS.nodeType.library);
  NODE_TYPE_COLORS.sdk      = readCssVar("--color-node-library",  DEFAULTS.nodeType.sdk);
  NODE_TYPE_COLORS.frontend = readCssVar("--color-warn",          DEFAULTS.nodeType.frontend);
  NODE_TYPE_COLORS.service  = readCssVar("--color-node-service",  DEFAULTS.nodeType.service);
  NODE_TYPE_COLORS.infra    = readCssVar("--color-node-infra",    DEFAULTS.nodeType.infra);
  NODE_TYPE_COLORS.actor    = readCssVar("--color-node-actor",    DEFAULTS.nodeType.actor);

  // Hub-style tints — drawn behind the node fill to give type scannability
  // without changing shape. (Shape-per-type taxonomy is a separate change.)
  NODE_TINT_COLORS.database = readCssVar("--color-node-tint-database", DEFAULTS.nodeTint.database);
  NODE_TINT_COLORS.broker   = readCssVar("--color-node-tint-broker",   DEFAULTS.nodeTint.broker);
  NODE_TINT_COLORS.external = readCssVar("--color-node-tint-external", DEFAULTS.nodeTint.external);
  NODE_TINT_COLORS.frontend = readCssVar("--color-node-tint-frontend", DEFAULTS.nodeTint.frontend);
}

export const BUNDLE_SEVERITY = ["rest", "grpc", "events", "db", "internal", "sdk", "import", "other"];

/**
 * Line dash patterns per protocol.
 * Values are logical pixels — caller must divide by transform.scale.
 * EDGE-01: REST  → solid
 * EDGE-02: gRPC  → dashed  [6, 4]
 * Aligned with arcanon-hub (DependencyEdge.tsx): all protocols use solid lines;
 * color alone differentiates them. The earlier per-protocol dashing pre-dated
 * the hub's design system and contradicted it.
 */
export const PROTOCOL_LINE_DASH = {
  rest:     [],
  grpc:     [],
  events:   [],
  db:       [],
  internal: [],
  sdk:      [],
  import:   [],
  other:    [],
};
