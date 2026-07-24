// Routing under uncertainty (S-2): Yen's K-shortest on expected weights
// generates the candidate set; one portfolio-wide Monte Carlo pass evaluates
// every candidate under the current severities; candidates are then ranked
// by the analyst's chosen risk policy. Pure module — runs identically on the
// main thread, in the Web Worker, and under tsx tests.

import { buildAdjacency, kShortestPaths } from "./engine";
import {
  evaluatePortfolioMC,
  policyScore,
  DEFAULT_STOCHASTIC_OPTIONS,
  type CandidatePath,
  type PathStats,
  type RiskPolicy,
  type StochasticOptions,
} from "../stochastic/model";
import type {
  PathResult,
  RegionSeverity,
  SupplyChainGraph,
  SupplierRow,
} from "../types";

/** Candidates generated per (supplier, origin) pair before ranking. */
export const CANDIDATE_K = 6;
/** Alternatives surfaced to the analyst after ranking. */
export const TOP_PATHS = 3;

export interface StochasticPathResult extends PathResult {
  stats: PathStats;
}

export interface StochasticRouting {
  supplierId: string;
  originNodeId: string;
  /** Comtrade dependency share this origin represents for the supplier. */
  sharePct: number;
  /** Ranked best-first under the active risk policy. */
  paths: StochasticPathResult[];
}

export interface StochasticComputation {
  routings: StochasticRouting[];
  edgeP95Ratio: Record<string, number>;
  policy: RiskPolicy;
  n: number;
  seed: number;
  sla: number;
}

export function computeStochasticRoutings(
  graph: SupplyChainGraph,
  suppliers: SupplierRow[],
  severity: RegionSeverity,
  policy: RiskPolicy,
  options: Partial<StochasticOptions> = {},
): StochasticComputation {
  const opts = { ...DEFAULT_STOCHASTIC_OPTIONS, ...options };
  const adj = buildAdjacency(graph);

  // 1. Candidate generation across ALL Tier-2 origins per supplier (S-2.2).
  interface Group {
    supplierId: string;
    originNodeId: string;
    sharePct: number;
    candidates: PathResult[];
  }
  const groups: Group[] = [];
  for (const s of suppliers) {
    for (const dep of s.tier2Dependencies) {
      const candidates = kShortestPaths(adj, dep.originNodeId, s.id, CANDIDATE_K, severity);
      if (candidates.length > 0) {
        groups.push({
          supplierId: s.id,
          originNodeId: dep.originNodeId,
          sharePct: dep.sharePct,
          candidates,
        });
      }
    }
  }

  // 2. One MC pass over the union of candidates (CRN across everything).
  const seen = new Map<string, CandidatePath>();
  for (const g of groups) {
    for (const p of g.candidates) {
      const id = p.edgeIds.join("|");
      if (!seen.has(id)) seen.set(id, { id, edgeIds: p.edgeIds });
    }
  }
  const evaluation = evaluatePortfolioMC(
    graph.edges,
    Array.from(seen.values()),
    severity,
    opts,
  );

  // 3. Rank purely by the chosen risk metric so the recommendation is always
  //    consistent with the policy the analyst picked (P95 → lowest P95, etc.).
  //    Freight is a real trade-off but lives in different units (cost, not
  //    days), so it only breaks near-ties — routes whose metric differs by
  //    less than a small tolerance prefer the cheaper option. The freight
  //    delta is always shown to the analyst, never hidden inside the score.
  const TOL = policy === "onTime" ? 0.02 : 0.5; // 2 pts on-time, or 0.5 day
  const rank = (a: StochasticPathResult, b: StochasticPathResult): number => {
    const sa = policyScore(a.stats, policy);
    const sb = policyScore(b.stats, policy);
    if (Math.abs(sa - sb) > TOL) return sa - sb;
    return a.totalFreightCost - b.totalFreightCost || a.totalWeight - b.totalWeight;
  };

  const routings: StochasticRouting[] = groups.map((g) => ({
    supplierId: g.supplierId,
    originNodeId: g.originNodeId,
    sharePct: g.sharePct,
    paths: g.candidates
      .map((p) => ({ ...p, stats: evaluation.pathStats[p.edgeIds.join("|")] }))
      .filter((p): p is StochasticPathResult => !!p.stats)
      .sort(rank)
      .slice(0, TOP_PATHS),
  }));

  return {
    routings,
    edgeP95Ratio: evaluation.edgeP95Ratio,
    policy,
    n: opts.n,
    seed: opts.seed,
    sla: opts.sla,
  };
}
