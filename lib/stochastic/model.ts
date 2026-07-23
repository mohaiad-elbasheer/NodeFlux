// Stochastic lead-time model + Monte Carlo evaluator.
//
// Per scenario:
//   1. Regional shocks: each region with slider severity s has a disruption
//      event with probability min(0.95, s); its magnitude
//      M_r ~ Lognormal(ln(0.4 + 2.2 s), 0.55) is drawn ONCE per region per
//      scenario — a common shock shared by every leg exposed to the region,
//      which is what correlates same-region legs (one-factor shock model).
//   2. Idiosyncratic leg variation: each edge draws
//      L_e ~ PERT(0.85·mode, mode, mode·(1.15 + 2·baselineRisk)) once per
//      scenario, shared by every candidate path that uses the edge
//      (common random numbers), then multiplied by (1 + M_r) for each
//      disrupted region in edge.regions.
//
// All parameters live in MODEL_PARAMS below and are calibration stubs to be
// replaced by fitted values when live data lands (see docs/MODEL.md).

import { makeRng, deriveSeed } from "./rng";
import { pertSample, lognormalSample, type PertParams } from "./distributions";
import type { GraphEdge, RegionSeverity } from "../types";

export const MODEL_PARAMS = {
  /** Idiosyncratic PERT spread around each leg's modal lead time. */
  pertMinFactor: 0.85,
  pertMaxBase: 1.15,
  pertMaxRiskGain: 2.0,
  /** Regional disruption event probability cap and magnitude parameters. */
  eventProbCap: 0.95,
  magnitudeMuBase: 0.4,
  magnitudeMuGain: 2.2,
  magnitudeSigma: 0.55,
} as const;

export interface StochasticOptions {
  n: number;
  seed: number;
  /** SLA in days applied to inbound (origin -> supplier) lead time. */
  sla: number;
}

export const DEFAULT_STOCHASTIC_OPTIONS: StochasticOptions = {
  n: 2000,
  seed: 42,
  sla: 30,
};

export interface PathStats {
  mean: number;
  stdev: number;
  p50: number;
  p90: number;
  p95: number;
  /** Mean of the worst 5% of scenarios (expected shortfall). */
  cvar95: number;
  /** P(inbound lead time <= SLA). */
  onTimeProb: number;
  /** Compact histogram for UI sparklines. */
  histogram: { bins: number[]; lo: number; hi: number };
}

export interface CandidatePath {
  /** Stable id: joined edge ids. */
  id: string;
  edgeIds: string[];
}

export function pertParamsFor(edge: GraphEdge): PertParams {
  const mode = edge.baseLeadTime;
  return {
    min: mode * MODEL_PARAMS.pertMinFactor,
    mode,
    max: mode * (MODEL_PARAMS.pertMaxBase + MODEL_PARAMS.pertMaxRiskGain * edge.baselineRisk),
  };
}

function quantileSorted(sorted: Float64Array, q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

function statsFromSamples(samples: Float64Array, sla: number): PathStats {
  const n = samples.length;
  const sorted = Float64Array.from(samples).sort();
  let sum = 0;
  let sumSq = 0;
  let onTime = 0;
  for (let i = 0; i < n; i++) {
    sum += samples[i];
    sumSq += samples[i] * samples[i];
    if (samples[i] <= sla) onTime++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);

  const tailStart = Math.floor(0.95 * n);
  let tailSum = 0;
  for (let i = tailStart; i < n; i++) tailSum += sorted[i];
  const cvar95 = tailSum / Math.max(1, n - tailStart);

  const BINS = 24;
  const lo = sorted[0];
  const hi = sorted[n - 1];
  const bins = new Array<number>(BINS).fill(0);
  const width = Math.max(1e-9, (hi - lo) / BINS);
  for (let i = 0; i < n; i++) {
    bins[Math.min(BINS - 1, Math.floor((samples[i] - lo) / width))]++;
  }

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    mean: r1(mean),
    stdev: r1(Math.sqrt(variance)),
    p50: r1(quantileSorted(sorted, 0.5)),
    p90: r1(quantileSorted(sorted, 0.9)),
    p95: r1(quantileSorted(sorted, 0.95)),
    cvar95: r1(cvar95),
    onTimeProb: Math.round((onTime / n) * 1000) / 1000,
    histogram: { bins, lo: r1(lo), hi: r1(hi) },
  };
}

export interface PortfolioEvaluation {
  /** Keyed by CandidatePath.id. */
  pathStats: Record<string, PathStats>;
  /** Per-edge P95 / modal lead time ratio (>= ~1), for tail-risk coloring. */
  edgeP95Ratio: Record<string, number>;
  n: number;
  seed: number;
  sla: number;
}

/**
 * One Monte Carlo pass over the whole candidate portfolio. Edge and region
 * draws are shared across every path within a scenario (CRN), so path
 * comparisons and deltas are low-variance and fair.
 */
export function evaluatePortfolioMC(
  edges: GraphEdge[],
  candidates: CandidatePath[],
  severity: RegionSeverity,
  options: Partial<StochasticOptions> = {},
): PortfolioEvaluation {
  const { n, seed, sla } = { ...DEFAULT_STOCHASTIC_OPTIONS, ...options };

  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const usedEdgeIds = Array.from(new Set(candidates.flatMap((c) => c.edgeIds))).sort();
  const usedEdges = usedEdgeIds
    .map((id) => edgeById.get(id))
    .filter((e): e is GraphEdge => !!e);
  const pertParams = usedEdges.map(pertParamsFor);

  const activeRegions = Object.entries(severity)
    .filter(([, s]) => s > 0)
    .map(([r]) => r)
    .sort();

  // Independent, deterministic streams: regions vs idiosyncratic edges.
  const regionRng = makeRng(deriveSeed(seed, "regions"));
  const edgeRng = makeRng(deriveSeed(seed, "edges"));

  const edgeSamples = new Map<string, Float64Array>(
    usedEdges.map((e) => [e.id, new Float64Array(n)]),
  );

  for (let k = 0; k < n; k++) {
    // 1. Regional common shocks for this scenario.
    const magnitudes = new Map<string, number>();
    for (const r of activeRegions) {
      const s = severity[r] ?? 0;
      const occurs = regionRng() < Math.min(MODEL_PARAMS.eventProbCap, s);
      if (occurs) {
        magnitudes.set(
          r,
          lognormalSample(
            regionRng,
            Math.log(MODEL_PARAMS.magnitudeMuBase + MODEL_PARAMS.magnitudeMuGain * s),
            MODEL_PARAMS.magnitudeSigma,
          ),
        );
      } else {
        // Keep the draw count fixed so scenario streams stay aligned
        // regardless of event outcomes (needed for clean CRN comparisons).
        lognormalSample(regionRng, 0, 1);
      }
    }

    // 2. Idiosyncratic leg draws + shock application.
    for (let i = 0; i < usedEdges.length; i++) {
      const e = usedEdges[i];
      let t = pertSample(edgeRng, pertParams[i]);
      for (const r of e.regions ?? []) {
        const m = magnitudes.get(r);
        if (m !== undefined) t *= 1 + m;
      }
      edgeSamples.get(e.id)![k] = t;
    }
  }

  // 3. Path aggregation and stats.
  const pathStats: Record<string, PathStats> = {};
  for (const c of candidates) {
    const samples = new Float64Array(n);
    for (const edgeId of c.edgeIds) {
      const es = edgeSamples.get(edgeId);
      if (!es) continue;
      for (let k = 0; k < n; k++) samples[k] += es[k];
    }
    pathStats[c.id] = statsFromSamples(samples, sla);
  }

  const edgeP95Ratio: Record<string, number> = {};
  for (const e of usedEdges) {
    const sorted = Float64Array.from(edgeSamples.get(e.id)!).sort();
    const p95 = quantileSorted(sorted, 0.95);
    edgeP95Ratio[e.id] = Math.round((p95 / Math.max(1e-9, e.baseLeadTime)) * 100) / 100;
  }

  return { pathStats, edgeP95Ratio, n, seed, sla };
}

export type RiskPolicy = "expected" | "p95" | "cvar95" | "onTime";

export const RISK_POLICIES: { id: RiskPolicy; label: string; hint: string }[] = [
  { id: "expected", label: "Expected", hint: "Rank by mean lead time" },
  { id: "p95", label: "P95", hint: "Risk-averse: rank by 95th percentile" },
  { id: "cvar95", label: "CVaR₉₅", hint: "Rank by expected worst-5% outcome" },
  { id: "onTime", label: "On-time", hint: "Maximize P(≤ SLA)" },
];

/** Lower is better for every policy (onTime is negated). */
export function policyScore(stats: PathStats, policy: RiskPolicy): number {
  switch (policy) {
    case "expected":
      return stats.mean;
    case "p95":
      return stats.p95;
    case "cvar95":
      return stats.cvar95;
    case "onTime":
      return -stats.onTimeProb;
  }
}
