// Stochastic shortest-path engine.
//
// Edge weight (per spec):
//   weight = baseLeadTime * (1 + macroRiskModifier) + staticFreightCost
// where macroRiskModifier = edge baseline risk + slider-injected bottleneck
// severity for edges touching the affected region.
//
// Dijkstra gives the optimal inbound path per supplier; Yen's algorithm
// enumerates the K best loopless alternatives for the analyst report.

import type {
  GraphEdge,
  GraphNode,
  PathResult,
  RegionSeverity,
  SupplierRouting,
  SupplyChainGraph,
  SupplierRow,
} from "../types";

export const MAX_RISK_MODIFIER = 2.5;

export function effectiveEdgeRisk(
  edge: GraphEdge,
  _nodesById: Map<string, GraphNode>,
  severity: RegionSeverity,
): number {
  // Severities are additive across every region the leg is exposed to, so a
  // Malacca->Suez transit responds to both sliders (capped for stability).
  let injected = 0;
  for (const r of edge.regions ?? []) injected += severity[r] ?? 0;
  return Math.min(MAX_RISK_MODIFIER, edge.baselineRisk + injected);
}

export function edgeWeight(edge: GraphEdge, risk: number): number {
  return edge.baseLeadTime * (1 + risk) + edge.staticFreightCost;
}

interface Adjacency {
  out: Map<string, GraphEdge[]>;
  nodesById: Map<string, GraphNode>;
}

export function buildAdjacency(graph: SupplyChainGraph): Adjacency {
  const out = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e);
  }
  return { out, nodesById: new Map(graph.nodes.map((n) => [n.id, n])) };
}

function pathFromParents(
  parents: Map<string, GraphEdge>,
  source: string,
  target: string,
): { nodeIds: string[]; edges: GraphEdge[] } | null {
  const nodeIds: string[] = [target];
  const edges: GraphEdge[] = [];
  let cur = target;
  while (cur !== source) {
    const e = parents.get(cur);
    if (!e) return null;
    edges.unshift(e);
    nodeIds.unshift(e.source);
    cur = e.source;
  }
  return { nodeIds, edges };
}

/** Dijkstra with optional node/edge exclusions (used by Yen's spur search). */
function dijkstra(
  adj: Adjacency,
  source: string,
  target: string,
  severity: RegionSeverity,
  excludedNodes?: Set<string>,
  excludedEdges?: Set<string>,
): { nodeIds: string[]; edges: GraphEdge[] } | null {
  if (excludedNodes?.has(source) || excludedNodes?.has(target)) return null;

  const dist = new Map<string, number>([[source, 0]]);
  const parents = new Map<string, GraphEdge>();
  const done = new Set<string>();
  // Array-scan priority queue: graphs here are tiny (tens of nodes).
  const frontier = new Set<string>([source]);

  while (frontier.size > 0) {
    let u: string | null = null;
    let best = Infinity;
    for (const id of frontier) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        u = id;
      }
    }
    if (u === null) break;
    frontier.delete(u);
    if (u === target) break;
    done.add(u);

    for (const e of adj.out.get(u) ?? []) {
      if (excludedEdges?.has(e.id)) continue;
      if (excludedNodes?.has(e.target)) continue;
      if (done.has(e.target)) continue;
      const w = edgeWeight(e, effectiveEdgeRisk(e, adj.nodesById, severity));
      const nd = best + w;
      if (nd < (dist.get(e.target) ?? Infinity)) {
        dist.set(e.target, nd);
        parents.set(e.target, e);
        frontier.add(e.target);
      }
    }
  }

  if (!dist.has(target)) return null;
  return pathFromParents(parents, source, target);
}

export function scorePath(
  nodeIds: string[],
  edges: GraphEdge[],
  adj: Adjacency,
  severity: RegionSeverity,
): PathResult {
  let totalWeight = 0;
  let totalLeadTimeDays = 0;
  let totalFreightCost = 0;
  let riskSum = 0;
  const regions = new Set<string>();

  for (const e of edges) {
    const risk = effectiveEdgeRisk(e, adj.nodesById, severity);
    totalWeight += edgeWeight(e, risk);
    totalLeadTimeDays += e.baseLeadTime * (1 + risk);
    totalFreightCost += e.staticFreightCost;
    riskSum += risk;
  }
  for (const id of nodeIds) {
    const region = adj.nodesById.get(id)?.region;
    if (region) regions.add(region);
  }

  const meanRisk = edges.length > 0 ? riskSum / edges.length : 0;

  return {
    nodeIds,
    edgeIds: edges.map((e) => e.id),
    totalWeight: Math.round(totalWeight * 10) / 10,
    totalLeadTimeDays: Math.round(totalLeadTimeDays * 10) / 10,
    totalFreightCost: Math.round(totalFreightCost * 10) / 10,
    vulnerabilityScore: Math.round(meanRisk * 100) / 10, // 0..10 scale
    regionsTraversed: Array.from(regions),
  };
}

/** Yen's K shortest loopless paths. */
export function kShortestPaths(
  adj: Adjacency,
  source: string,
  target: string,
  k: number,
  severity: RegionSeverity,
): PathResult[] {
  const first = dijkstra(adj, source, target, severity);
  if (!first) return [];

  const A: { nodeIds: string[]; edges: GraphEdge[] }[] = [first];
  const B: { nodeIds: string[]; edges: GraphEdge[]; weight: number }[] = [];

  const pathWeight = (edges: GraphEdge[]) =>
    edges.reduce(
      (acc, e) => acc + edgeWeight(e, effectiveEdgeRisk(e, adj.nodesById, severity)),
      0,
    );

  for (let ki = 1; ki < k; ki++) {
    const prev = A[ki - 1];

    for (let i = 0; i < prev.nodeIds.length - 1; i++) {
      const spurNode = prev.nodeIds[i];
      const rootNodeIds = prev.nodeIds.slice(0, i + 1);
      const rootEdges = prev.edges.slice(0, i);

      const excludedEdges = new Set<string>();
      for (const p of A) {
        if (
          p.nodeIds.length > i &&
          rootNodeIds.every((id, j) => p.nodeIds[j] === id)
        ) {
          const e = p.edges[i];
          if (e) excludedEdges.add(e.id);
        }
      }
      const excludedNodes = new Set(rootNodeIds.slice(0, -1));

      const spur = dijkstra(adj, spurNode, target, severity, excludedNodes, excludedEdges);
      if (!spur) continue;

      const candNodeIds = [...rootNodeIds.slice(0, -1), ...spur.nodeIds];
      const candEdges = [...rootEdges, ...spur.edges];
      const key = candNodeIds.join("|");
      if (A.some((p) => p.nodeIds.join("|") === key)) continue;
      if (B.some((p) => p.nodeIds.join("|") === key)) continue;

      B.push({ nodeIds: candNodeIds, edges: candEdges, weight: pathWeight(candEdges) });
    }

    if (B.length === 0) break;
    B.sort((a, b) => a.weight - b.weight);
    const next = B.shift()!;
    A.push({ nodeIds: next.nodeIds, edges: next.edges });
  }

  return A.map((p) => scorePath(p.nodeIds, p.edges, adj, severity));
}

/**
 * Compute the top-K inbound routings for every supplier, from its
 * highest-concentration Tier-2 origin down to the supplier node.
 */
export function computeRoutings(
  graph: SupplyChainGraph,
  suppliers: SupplierRow[],
  severity: RegionSeverity,
  k = 3,
): SupplierRouting[] {
  const adj = buildAdjacency(graph);
  const routings: SupplierRouting[] = [];

  for (const s of suppliers) {
    const primary = [...s.tier2Dependencies].sort((a, b) => b.sharePct - a.sharePct)[0];
    if (!primary) continue;
    const paths = kShortestPaths(adj, primary.originNodeId, s.id, k, severity);
    if (paths.length === 0) continue;
    routings.push({ supplierId: s.id, originNodeId: primary.originNodeId, paths });
  }

  return routings;
}
