// Explainability: analytic decomposition of a path's expected lead time into
// base transit + per-region disruption contributions. This is what answers
// "why is this route vulnerable, and to what". It is exact for the mean (no
// Monte Carlo needed) because expectation is linear over the sum of legs and
// the regional shocks are independent across regions.
//
// For region r with slider severity s, a leg tagged with r is multiplied by
// (1 + M_r) when an event occurs, so its expected multiplier is:
//   1 + g_r,  where  g_r = P(event_r) · E[M_r]
//                        = min(0.95, s) · (0.4 + 2.2·s) · exp(σ²/2)
// (matching MODEL_PARAMS: eventProbCap, magnitudeMuBase/Gain, magnitudeSigma).
//
// A leg in regions {r1, r2} has expected factor (1+g1)(1+g2) = 1 + g1 + g2 +
// g1·g2. We attribute g_k·E[L] to region k and the cross term g1·g2·E[L] to a
// separate "compound" bucket, so the parts sum exactly to the expected total.

import { MODEL_PARAMS } from "./model";
import { pertMean, type PertParams } from "./distributions";
import { pertParamsFor } from "./model";
import type { GraphEdge, RegionSeverity } from "../types";

/** Expected multiplicative delay factor contributed by region r at severity s. */
export function regionGain(s: number): number {
  if (s <= 0) return 0;
  const prob = Math.min(MODEL_PARAMS.eventProbCap, s);
  const meanMagnitude =
    (MODEL_PARAMS.magnitudeMuBase + MODEL_PARAMS.magnitudeMuGain * s) *
    Math.exp((MODEL_PARAMS.magnitudeSigma * MODEL_PARAMS.magnitudeSigma) / 2);
  return prob * meanMagnitude;
}

export interface DelayAttribution {
  /** Expected transit with no disruptions (Σ leg means). */
  baseDays: number;
  /** Expected total transit under current severities. */
  totalDays: number;
  /** Added days attributed to each region (region → days), largest first. */
  byRegion: { region: string; days: number }[];
  /** Added days from multi-region compounding on shared legs. */
  compoundDays: number;
  /** totalDays − baseDays. */
  addedDays: number;
}

/**
 * Decompose a path (ordered edges) into base + per-region + compound delay.
 * `severity` is the current slider state.
 */
export function attributePathDelay(
  edges: GraphEdge[],
  severity: RegionSeverity,
): DelayAttribution {
  const gain = new Map<string, number>();
  const regionDays = new Map<string, number>();
  let baseDays = 0;
  let compoundDays = 0;

  const gFor = (r: string): number => {
    if (!gain.has(r)) gain.set(r, regionGain(severity[r] ?? 0));
    return gain.get(r)!;
  };

  for (const e of edges) {
    const params: PertParams = pertParamsFor(e);
    const meanL = pertMean(params);
    baseDays += meanL;

    const regions = (e.regions ?? []).filter((r) => (severity[r] ?? 0) > 0);
    if (regions.length === 0) continue;

    // First-order (per-region) contributions.
    for (const r of regions) {
      const contrib = meanL * gFor(r);
      regionDays.set(r, (regionDays.get(r) ?? 0) + contrib);
    }
    // Higher-order interaction: product over (1+g) minus the linear terms.
    const factor = regions.reduce((acc, r) => acc * (1 + gFor(r)), 1);
    const linear = regions.reduce((acc, r) => acc + gFor(r), 0);
    compoundDays += meanL * (factor - 1 - linear);
  }

  const byRegion = Array.from(regionDays.entries())
    .map(([region, days]) => ({ region, days: Math.round(days * 10) / 10 }))
    .filter((x) => x.days > 0.05)
    .sort((a, b) => b.days - a.days);

  const round1 = (x: number) => Math.round(x * 10) / 10;
  const addedDays =
    byRegion.reduce((a, b) => a + b.days, 0) + Math.round(compoundDays * 10) / 10;

  return {
    baseDays: round1(baseDays),
    totalDays: round1(baseDays + addedDays),
    byRegion,
    compoundDays: round1(compoundDays),
    addedDays: round1(addedDays),
  };
}
