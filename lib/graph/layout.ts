// Layered DAG layout for the React Flow canvas: longest-path layering
// (origins left → ports by depth → suppliers → hub right), nodes stacked
// vertically within each layer.

import type { SupplyChainGraph } from "../types";

export interface LayoutPositions {
  [nodeId: string]: { x: number; y: number };
}

const LAYER_WIDTH = 280;
const ROW_HEIGHT = 96;

export function layeredLayout(graph: SupplyChainGraph): LayoutPositions {
  const layer = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();

  for (const n of graph.nodes) {
    adj.set(n.id, []);
    indeg.set(n.id, 0);
    layer.set(n.id, 0);
  }
  for (const e of graph.edges) {
    adj.get(e.source)?.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  // Longest-path layering via topological order.
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of adj.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  // Pin semantic layers so the reading order is stable even for odd graphs:
  // suppliers sit one layer before the hub, hub is always last.
  const maxPortLayer = Math.max(
    0,
    ...graph.nodes.filter((n) => n.kind === "port").map((n) => layer.get(n.id) ?? 0),
  );
  const supplierLayer = maxPortLayer + 1;
  for (const n of graph.nodes) {
    if (n.kind === "supplier") layer.set(n.id, supplierLayer);
    if (n.kind === "hub") layer.set(n.id, supplierLayer + 1);
  }

  // Group by layer, order rows for legibility (region, then label).
  const byLayer = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const l = layer.get(n.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n.id);
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const positions: LayoutPositions = {};

  for (const [l, ids] of byLayer) {
    ids.sort((a, b) => {
      const na = nodeById.get(a)!;
      const nb = nodeById.get(b)!;
      const ra = na.region ?? "";
      const rb = nb.region ?? "";
      if (ra !== rb) return ra.localeCompare(rb);
      return na.label.localeCompare(nb.label);
    });
    const offset = -((ids.length - 1) * ROW_HEIGHT) / 2;
    ids.forEach((id, i) => {
      positions[id] = { x: l * LAYER_WIDTH, y: offset + i * ROW_HEIGHT };
    });
  }

  return positions;
}
