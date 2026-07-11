"use client";

// Analyst report: Top-3 recommended inbound pathways for the supplier in
// focus (selected, or the one hit hardest by the active simulation), with
// comparative lead-time deltas and regional vulnerability scoring.

import { useMemo } from "react";
import { ArrowRight, Route, TrendingDown, TrendingUp } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { fmtDelta, riskBadgeClasses } from "@/lib/utils";
import type { PathResult, SupplierRouting } from "@/lib/types";

const MODE_HINTS: Record<string, string> = {
  "rail-eurasia": "Rail Corridor",
  "air-hub-global": "Air Freight",
  "route-suez": "Suez",
  "route-panama": "Panama",
  "route-malacca": "Malacca",
};

export default function AltPathsReport() {
  const dataset = useAppStore((s) => s.dataset);
  const nodesById = useAppStore((s) => s.nodesById);
  const routings = useAppStore((s) => s.routings);
  const baselineRoutings = useAppStore((s) => s.baselineRoutings);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const severity = useAppStore((s) => s.regionSeverity);
  const highlightPath = useAppStore((s) => s.highlightPath);
  const highlightedPath = useAppStore((s) => s.highlightedPath);

  const baselineBySupplier = useMemo(
    () => new Map(baselineRoutings.map((r) => [r.supplierId, r])),
    [baselineRoutings],
  );

  // Supplier in focus: explicit selection wins; otherwise the supplier whose
  // best path degraded the most under the current simulation.
  const focus: SupplierRouting | undefined = useMemo(() => {
    const selected = selectedNodeId
      ? routings.find((r) => r.supplierId === selectedNodeId)
      : undefined;
    if (selected) return selected;
    let worst: SupplierRouting | undefined;
    let worstDelta = -Infinity;
    for (const r of routings) {
      const base = baselineBySupplier.get(r.supplierId)?.paths[0];
      const cur = r.paths[0];
      if (!base || !cur) continue;
      const delta = cur.totalWeight - base.totalWeight;
      if (delta > worstDelta) {
        worstDelta = delta;
        worst = r;
      }
    }
    return worst ?? routings[0];
  }, [routings, selectedNodeId, baselineBySupplier]);

  if (!dataset || !focus) return null;

  const supplier = dataset.suppliers.find((s) => s.id === focus.supplierId);
  const baselineBest = baselineBySupplier.get(focus.supplierId)?.paths[0];
  const hotRegions = new Set(
    Object.entries(severity)
      .filter(([, v]) => v >= 0.3)
      .map(([r]) => r),
  );

  const routeSummary = (p: PathResult) =>
    p.nodeIds
      .map((id) => {
        const n = nodesById.get(id);
        if (!n) return null;
        if (n.kind === "port") return MODE_HINTS[id] ?? n.label.replace(/^Port of /, "");
        if (n.kind === "raw-origin") return n.label.split("—")[0].trim();
        return n.label;
      })
      .filter(Boolean);

  const narrative = (p: PathResult, i: number) => {
    if (!baselineBest) return null;
    const delta = p.totalLeadTimeDays - baselineBest.totalLeadTimeDays;
    const avoided = Array.from(hotRegions).filter(
      (r) => !p.regionsTraversed.includes(r),
    );
    if (hotRegions.size === 0) {
      return i === 0
        ? "Current optimal pathway under baseline conditions."
        : `Fallback option: ${fmtDelta(delta)} vs. the optimal route.`;
    }
    if (avoided.length === hotRegions.size) {
      return `Avoids the ${avoided.join(" & ")} bottleneck${avoided.length > 1 ? "s" : ""}, ${
        delta > 0 ? `but increases lead time by ${fmtDelta(delta).replace("+", "")}` : "with no lead-time penalty"
      } vs. pre-disruption baseline.`;
    }
    const exposed = p.regionsTraversed.filter((r) => hotRegions.has(r));
    return `Still exposed to ${exposed.join(", ")} — lead time ${fmtDelta(delta)} vs. pre-disruption baseline.`;
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Route className="h-3.5 w-3.5 text-sky-400" />
        Top {Math.min(3, focus.paths.length)} Recommended Pathways
      </h3>
      <p className="mt-1 text-[11px] text-slate-500">
        {supplier?.supplierName ?? focus.supplierId} · inbound from{" "}
        {nodesById.get(focus.originNodeId)?.label.split("—")[0].trim() ?? "primary Tier-2 origin"}
        {!selectedNodeId && hotRegions.size > 0 && (
          <span className="ml-1 text-orange-400/80">(most impacted by simulation)</span>
        )}
      </p>

      <ol className="mt-3 space-y-2">
        {focus.paths.slice(0, 3).map((p, i) => {
          const isHighlighted =
            highlightedPath?.edgeIds.join() === p.edgeIds.join();
          const deltaVsBest = baselineBest
            ? p.totalLeadTimeDays - baselineBest.totalLeadTimeDays
            : 0;
          return (
            <li key={p.edgeIds.join()}>
              <button
                onClick={() =>
                  highlightPath(
                    isHighlighted ? null : { nodeIds: p.nodeIds, edgeIds: p.edgeIds },
                  )
                }
                className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                  isHighlighted
                    ? "border-sky-500/60 bg-sky-500/10"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-200">
                    Path {i + 1}
                    {i === 0 && (
                      <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                        RECOMMENDED
                      </span>
                    )}
                  </span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${riskBadgeClasses(p.vulnerabilityScore / 10)}`}
                  >
                    VULN {p.vulnerabilityScore.toFixed(1)}/10
                  </span>
                </div>

                <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-slate-400">
                  {routeSummary(p).map((seg, j, arr) => (
                    <span key={j} className="inline-flex items-center gap-1">
                      {seg}
                      {j < arr.length - 1 && (
                        <ArrowRight className="h-2.5 w-2.5 text-slate-600" />
                      )}
                    </span>
                  ))}
                </p>

                <div className="mt-1.5 flex items-center gap-3 text-[10px] tabular-nums text-slate-400">
                  <span className="font-semibold text-slate-200">
                    {p.totalLeadTimeDays.toFixed(1)} days
                  </span>
                  {baselineBest && Math.abs(deltaVsBest) > 0.05 && (
                    <span
                      className={`inline-flex items-center gap-0.5 ${
                        deltaVsBest > 0 ? "text-orange-400" : "text-emerald-400"
                      }`}
                    >
                      {deltaVsBest > 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {fmtDelta(deltaVsBest)}
                    </span>
                  )}
                  <span className="ml-auto text-slate-500">
                    freight {p.totalFreightCost.toFixed(0)}u
                  </span>
                </div>

                <p className="mt-1.5 border-t border-slate-800/80 pt-1.5 text-[10px] leading-relaxed text-slate-500">
                  {narrative(p, i)}
                </p>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
