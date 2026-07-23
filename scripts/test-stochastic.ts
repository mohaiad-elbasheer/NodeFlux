// Statistical tests for the stochastic core (S-1.5).
// Run with: npx tsx scripts/test-stochastic.ts

import { makeRng } from "@/lib/stochastic/rng";
import {
  pertSample,
  pertMean,
  lognormalSample,
} from "@/lib/stochastic/distributions";
import {
  evaluatePortfolioMC,
  pertParamsFor,
} from "@/lib/stochastic/model";
import type { GraphEdge } from "@/lib/types";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// 1. Distribution sampling converges to analytic moments.
// ---------------------------------------------------------------------------
{
  const rng = makeRng(7);
  const p = { min: 8.5, mode: 10, max: 16 };
  const N = 40000;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += pertSample(rng, p);
  const sampleMean = sum / N;
  const analytic = pertMean(p); // (8.5 + 40 + 16) / 6 = 10.75
  check(
    "PERT sample mean matches analytic mean within 1%",
    Math.abs(sampleMean - analytic) / analytic < 0.01,
    `sample ${sampleMean.toFixed(3)} vs analytic ${analytic.toFixed(3)}`,
  );

  const mu = 0.5;
  const sigma = 0.55;
  let lsum = 0;
  for (let i = 0; i < N; i++) lsum += lognormalSample(rng, mu, sigma);
  const lAnalytic = Math.exp(mu + (sigma * sigma) / 2);
  check(
    "Lognormal sample mean matches exp(mu + sigma^2/2) within 2%",
    Math.abs(lsum / N - lAnalytic) / lAnalytic < 0.02,
    `sample ${(lsum / N).toFixed(3)} vs analytic ${lAnalytic.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------
// Synthetic fixture: three legs, two sharing a region.
// ---------------------------------------------------------------------------
const mkEdge = (id: string, days: number, regions: string[]): GraphEdge => ({
  id,
  source: `${id}-s`,
  target: `${id}-t`,
  baseLeadTime: days,
  staticFreightCost: 1,
  baselineRisk: 0.1,
  mode: "sea",
  regions,
});
const eA = mkEdge("eA", 10, ["Suez Canal"]);
const eB = mkEdge("eB", 12, ["Suez Canal"]);
const eC = mkEdge("eC", 11, ["Panama Canal"]);
const EDGES = [eA, eB, eC];
const pathA = { id: "A", edgeIds: ["eA"] };
const pathB = { id: "B", edgeIds: ["eB"] };
const pathC = { id: "C", edgeIds: ["eC"] };
const pathAB = { id: "AB", edgeIds: ["eA", "eB"] };
const pathAC = { id: "AC", edgeIds: ["eA", "eC"] };

// ---------------------------------------------------------------------------
// 2. Seed reproducibility: byte-exact repeat, different seed differs.
// ---------------------------------------------------------------------------
{
  const run = (seed: number) =>
    JSON.stringify(
      evaluatePortfolioMC(EDGES, [pathA, pathAB], { "Suez Canal": 0.5 }, { n: 1500, seed }),
    );
  check("same seed reproduces results byte-exact", run(42) === run(42));
  check("different seed changes results", run(42) !== run(43));
}

// ---------------------------------------------------------------------------
// 3. Common random numbers: shared edge draws cancel exactly in deltas.
//    mean(AB) - mean(A) must equal mean(B) far tighter than MC noise allows
//    under independent sampling.
// ---------------------------------------------------------------------------
{
  const ev = evaluatePortfolioMC(EDGES, [pathA, pathB, pathAB], {}, { n: 2000, seed: 11 });
  const delta = ev.pathStats["AB"].mean - ev.pathStats["A"].mean;
  check(
    "CRN: mean(A+B) - mean(A) equals mean(B) up to rounding",
    Math.abs(delta - ev.pathStats["B"].mean) <= 0.21, // three 0.1-rounded stats
    `delta ${delta.toFixed(2)} vs mean(B) ${ev.pathStats["B"].mean}`,
  );
}

// ---------------------------------------------------------------------------
// 4. Regional common shock induces same-region correlation, not cross-region.
//    corr(A,B) recovered from Var(A+B) = Var(A) + Var(B) + 2 Cov(A,B).
// ---------------------------------------------------------------------------
{
  const sev = { "Suez Canal": 0.6, "Panama Canal": 0.6 };
  const ev = evaluatePortfolioMC(
    EDGES,
    [pathA, pathB, pathC, pathAB, pathAC],
    sev,
    { n: 6000, seed: 5 },
  );
  const corr = (sum: string, x: string, y: string) => {
    const vS = ev.pathStats[sum].stdev ** 2;
    const vX = ev.pathStats[x].stdev ** 2;
    const vY = ev.pathStats[y].stdev ** 2;
    return (vS - vX - vY) / (2 * Math.sqrt(vX * vY));
  };
  const sameRegion = corr("AB", "A", "B");
  const crossRegion = corr("AC", "A", "C");
  check(
    "same-region legs are strongly positively correlated under disruption",
    sameRegion > 0.3,
    `corr ${sameRegion.toFixed(3)}`,
  );
  check(
    "cross-region legs stay near-independent",
    Math.abs(crossRegion) < 0.15,
    `corr ${crossRegion.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------
// 5. Severity monotonicity: tail risk and SLA misses grow with the slider.
// ---------------------------------------------------------------------------
{
  const at = (s: number) =>
    evaluatePortfolioMC(EDGES, [pathAB], { "Suez Canal": s }, { n: 3000, seed: 9, sla: 30 })
      .pathStats["AB"];
  const s0 = at(0);
  const s4 = at(0.4);
  const s8 = at(0.8);
  check(
    "P95 increases with bottleneck severity",
    s0.p95 < s4.p95 && s4.p95 < s8.p95,
    `${s0.p95} < ${s4.p95} < ${s8.p95}`,
  );
  check(
    "on-time probability decreases with severity",
    s0.onTimeProb > s4.onTimeProb && s4.onTimeProb > s8.onTimeProb,
    `${s0.onTimeProb} > ${s4.onTimeProb} > ${s8.onTimeProb}`,
  );
  check(
    "zero severity keeps P95 near the PERT envelope (no phantom disruptions)",
    s0.p95 < (pertParamsFor(eA).max + pertParamsFor(eB).max) * 1.001,
    `p95 ${s0.p95}`,
  );
}

console.log(failures === 0 ? "\nAll stochastic tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
