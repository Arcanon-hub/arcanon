/**
 * Shared graph state — single source of truth for all UI modules.
 */

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
  activeProtocols: new Set(["rest", "grpc", "events", "internal", "sdk"]),
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

export const COLORS = {
  node: {
    default: "#4299e1",
    selected: "#f6ad55",
    blast: "#fc8181",
    dimmed: "#2d3748",
    new: "#f6e05e",        // warm yellow — what-changed overlay
  },
  edge: {
    default: "#4a5568",
    selected: "#f6ad55",
    blast: "#fc8181",
    dimmed: "#1a202c",
    new: "#f6e05e",        // warm yellow — what-changed overlay
  },
  label: {
    default: "#e2e8f0",
    dimmed: "#4a5568",
  },
};

export const PROTOCOL_COLORS = {
  rest: "#4299e1",
  grpc: "#68d391",
  events: "#9f7aea",
  internal: "#4a5568",
  sdk: "#d69e2e",
  import: "#d69e2e",
};

export const NODE_TYPE_COLORS = {
  library: "#9f7aea",
  sdk: "#9f7aea",
  frontend: "#f6ad55",
  service: "#4299e1",
  infra: '#68d391',
  actor: '#e06060',    // coral — distinct from all other types
};

export const BUNDLE_SEVERITY = ["rest", "grpc", "events", "internal", "sdk", "import"];

/**
 * Line dash patterns per protocol.
 * Values are logical pixels — caller must divide by transform.scale.
 * EDGE-01: REST  → solid
 * EDGE-02: gRPC  → dashed  [6, 4]
 * EDGE-03: events → dotted [2, 4]
 * EDGE-04: sdk/import → solid (no dash; arrowhead already drawn for all edges)
 */
export const PROTOCOL_LINE_DASH = {
  rest:     [],
  grpc:     [6, 4],
  events:   [2, 4],
  internal: [],
  sdk:      [],
  import:   [],
};
