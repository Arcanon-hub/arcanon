import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "https://cdn.jsdelivr.net/npm/d3-force@3/+esm";

let simulation = null;
let tickCount = 0;
const MAX_TICKS = 300;

self.addEventListener("message", ({ data }) => {
  switch (data.type) {
    case "init":
      initSimulation(data);
      break;
    case "reheat":
      if (simulation) simulation.alpha(0.3).restart();
      break;
    case "stop":
      if (simulation) simulation.stop();
      break;
    case "drag":
      handleDrag(data);
      break;
    default:
      break;
  }
});

function initSimulation({ nodes, links, width, height }) {
  // Stop any previous simulation
  if (simulation) simulation.stop();
  tickCount = 0;

  simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink(links)
        .id((d) => d.id)
        .distance(100)
        .strength(0.8),
    )
    .force("charge", forceManyBody().strength(-300))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide(22))
    .alphaDecay(1 - Math.pow(0.001, 1 / MAX_TICKS)); // decay tuned for ~300 ticks

  simulation.on("tick", () => {
    tickCount++;
    // Post only position data — not the full node objects
    const positions = simulation.nodes().map(({ id, x, y }) => ({ id, x, y }));
    self.postMessage({ type: "tick", nodes: positions });

    if (tickCount >= MAX_TICKS) {
      simulation.stop();
      self.postMessage({ type: "end" });
    }
  });

  simulation.on("end", () => {
    self.postMessage({ type: "end" });
  });
}

function handleDrag({ nodeId, x, y }) {
  if (!simulation) return;
  const node = simulation.nodes().find((n) => n.id === nodeId);
  if (node) {
    node.fx = x;
    node.fy = y;
    simulation.alpha(0.1).restart();
  }
}
