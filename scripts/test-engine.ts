// Engine sanity tests: weight formula, severity injection, K-shortest-path
// distinctness, and automated rerouting under a bottleneck spike.
// Run with: npx tsx scripts/test-engine.ts

import { rowsToSuppliers } from "@/lib/csv";
import { buildGraph } from "@/lib/graph/build";
import {
  buildAdjacency,
  computeRoutings,
  edgeWeight,
  effectiveEdgeRisk,
  kShortestPaths,
} from "@/lib/graph/engine";
import { REGIONS } from "@/data/comtrade-seed";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

const { suppliers } = rowsToSuppliers([
  {
    Supplier_Name: "Bavaria Semiconductor AG",
    Country_of_Origin: "Germany",
    City: "Dresden",
    Product_Description: "Power semiconductors",
    HS_Code_Chapter_85: "8541",
    Estimated_Lead_Time_Days: "28",
  },
  {
    Supplier_Name: "Austin Chip Fab",
    Country_of_Origin: "United States",
    City: "Austin",
    Product_Description: "Analog ICs",
    HS_Code_Chapter_85: "8542",
    Estimated_Lead_Time_Days: "25",
  },
]);
const graph = buildGraph(suppliers);
const adj = buildAdjacency(graph);

// 1. Weight formula: weight = baseLeadTime * (1 + risk) + staticFreightCost
{
  const e = graph.edges.find((x) => x.baseLeadTime > 0)!;
  const risk = effectiveEdgeRisk(e, adj.nodesById, {});
  const expected = e.baseLeadTime * (1 + risk) + e.staticFreightCost;
  check(
    "weight formula matches spec",
    Math.abs(edgeWeight(e, risk) - expected) < 1e-9,
    `${e.id}: ${edgeWeight(e, risk).toFixed(3)}`,
  );
}

// 2. Severity injection: an edge touching the region spikes by the slider value
{
  const e = graph.edges.find((x) => x.source === "route-suez" || x.target === "route-suez")!;
  const base = effectiveEdgeRisk(e, adj.nodesById, {});
  const spiked = effectiveEdgeRisk(e, adj.nodesById, { [REGIONS.SUEZ]: 0.8 });
  check(
    "Suez severity 80% raises edge risk by 0.8",
    Math.abs(spiked - base - 0.8) < 1e-9,
    `${base.toFixed(3)} -> ${spiked.toFixed(3)}`,
  );

  const unrelated = graph.edges.find(
    (x) => x.id === `${suppliers[0].id}->hub-central-dc`,
  )!;
  const uBase = effectiveEdgeRisk(unrelated, adj.nodesById, {});
  const uSpiked = effectiveEdgeRisk(unrelated, adj.nodesById, { [REGIONS.SUEZ]: 0.8 });
  check("unrelated edges unaffected by Suez slider", uBase === uSpiked);
}

// 3. K-shortest paths: distinct, loopless, sorted by weight
{
  const de = suppliers[0];
  const origin = de.tier2Dependencies[0].originNodeId;
  const paths = kShortestPaths(adj, origin, de.id, 3, {});
  check("returns up to 3 alternative paths", paths.length === 3, `${paths.length}`);
  const keys = paths.map((p) => p.nodeIds.join("|"));
  check("paths are distinct", new Set(keys).size === paths.length);
  check(
    "paths sorted by total weight",
    paths.every((p, i) => i === 0 || p.totalWeight >= paths[i - 1].totalWeight),
    paths.map((p) => p.totalWeight.toFixed(1)).join(" <= "),
  );
  check(
    "paths are loopless",
    paths.every((p) => new Set(p.nodeIds).size === p.nodeIds.length),
  );
}

// 4. Automated rerouting: spike a region on the optimal path, expect the new
//    optimal path to avoid it (Germany baseline best rides the Eurasia rail
//    corridor, which is tagged East Asia Hub).
{
  const de = suppliers[0];
  const baseline = computeRoutings(graph, suppliers, {}).find(
    (r) => r.supplierId === de.id,
  )!;
  const baseBest = baseline.paths[0];
  check(
    "baseline best path uses Eurasia rail corridor",
    baseBest.nodeIds.includes("rail-eurasia"),
    baseBest.nodeIds.join(" -> "),
  );

  const spiked = computeRoutings(graph, suppliers, { [REGIONS.EAST_ASIA]: 0.8 }).find(
    (r) => r.supplierId === de.id,
  )!;
  const spikedBest = spiked.paths[0];
  check(
    "80% East Asia bottleneck reroutes the optimal path off the rail corridor",
    !spikedBest.nodeIds.includes("rail-eurasia"),
    spikedBest.nodeIds.join(" -> "),
  );
  check(
    "disrupted optimum costs more than the pre-disruption optimum",
    spikedBest.totalWeight > baseBest.totalWeight,
    `${baseBest.totalWeight} -> ${spikedBest.totalWeight}`,
  );
  check(
    "vulnerability score rises under the bottleneck",
    spikedBest.vulnerabilityScore > baseBest.vulnerabilityScore,
    `${baseBest.vulnerabilityScore} -> ${spikedBest.vulnerabilityScore}`,
  );
}

// 4b. Order independence (QC-4): the graph must be identical however the
//     CSV rows are ordered.
{
  const canon = (g: ReturnType<typeof buildGraph>) =>
    JSON.stringify(
      [...g.edges]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => [e.id, e.baseLeadTime, e.staticFreightCost, e.mode, [...e.regions].sort()]),
    );
  const reversed = [...suppliers].reverse();
  check(
    "graph edges identical regardless of supplier row order",
    canon(buildGraph(suppliers)) === canon(buildGraph(reversed)),
  );
}

// 4c. Multi-region legs (QC-5): the Malacca->Suez transit responds to BOTH
//     sliders, additively.
{
  const e = graph.edges.find((x) => x.id === "route-malacca->route-suez")!;
  const base = effectiveEdgeRisk(e, adj.nodesById, {});
  const both = effectiveEdgeRisk(e, adj.nodesById, {
    [REGIONS.MALACCA]: 0.3,
    [REGIONS.SUEZ]: 0.4,
  });
  check(
    "Malacca->Suez leg stacks severity from both regions",
    Math.abs(both - base - 0.7) < 1e-9,
    `${base.toFixed(3)} -> ${both.toFixed(3)}`,
  );
}

// 5. Graceful degradation: suppliers with unknown countries still route
{
  const { suppliers: odd } = rowsToSuppliers([
    { Supplier_Name: "Mystery Ltd", Country_of_Origin: "Atlantis", City: "" },
  ]);
  const g2 = buildGraph(odd);
  const r2 = computeRoutings(g2, odd, {});
  check(
    "unknown-country supplier still gets routable paths",
    r2.length === 1 && r2[0].paths.length > 0,
    `${r2[0]?.paths.length ?? 0} paths`,
  );
}

console.log(failures === 0 ? "\nAll engine tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
