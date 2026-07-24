"use client";

// Analyst report: Top-3 recommended inbound pathways for the supplier in
// focus. Deterministic mode shows weight/lead-time deltas; stochastic mode
// shows distributional stats — histogram, P50/P95, CVaR, on-time gauge, and
// mean deltas with a CI half-width (conservative: ignores CRN covariance).

import { useMemo } from "react";
import { ArrowRight, Route, TrendingDown, TrendingUp } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useStochasticFocus } from "@/lib/useFocus";
import { fmtDelta, riskBadgeClasses } from "@/lib/utils";
import type { PathResult, SupplierRouting } from "@/lib/types";
import type { StochasticPathResult } from "@/lib/graph/stochastic-routing";
import type { PathStats } from "@/lib/stochastic/model";

const MODE_HINTS: Record<string, string> = {
  "rail-eurasia": "Rail Corridor",
  "air-hub-global": "Air Freight",
  "route-suez": "Suez",
  "route-panama": "Panama",
  "route-malacca": "Malacca",
};

function useRouteSummary() {
  const nodesById = useAppStore((s) => s.nodesById);
  return (p: PathResult) =>
    p.nodeIds
      .map((id) => {
        const n = nodesById.get(id);
        if (!n) return null;
        if (n.kind === "port") return MODE_HINTS[id] ?? n.label.replace(/^Port of /, "");
        if (n.kind === "raw-origin") return n.label.split("—")[0].trim();
        return n.label;
      })
      .filter((s): s is string => !!s);
}

function RouteBreadcrumb({ segments }: { segments: string[] }) {
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-slate-400">
      {segments.map((seg, j) => (
        <span key={j} className="inline-flex items-center gap-1">
          {seg}
          {j < segments.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-slate-600" />}
        </span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Stochastic widgets
// ---------------------------------------------------------------------------

function HistogramStrip({ stats }: { stats: PathStats }) {
  const { bins, lo, hi } = stats.histogram;
  const max = Math.max(1, ...bins);
  const span = Math.max(1e-9, hi - lo);
  const p95X = ((stats.p95 - lo) / span) * 100;
  return (
    <div className="relative mt-2 flex h-7 items-end gap-px" data-testid="path-histogram">
      {bins.map((b, i) => {
        const binStart = lo + (i / bins.length) * span;
        return (
          <div
            key={i}
            className={`flex-1 rounded-t-[1px] ${binStart >= stats.p95 ? "bg-rose-500/70" : "bg-sky-500/50"}`}
            style={{ height: `${Math.max(4, (b / max) * 100)}%` }}
          />
        );
      })}
      <div
        className="absolute bottom-0 top-0 w-px bg-rose-400/80"
        style={{ left: `${Math.min(99, Math.max(1, p95X))}%` }}
        title={`P95 = ${stats.p95}d`}
      />
    </div>
  );
}

function OnTimeGauge({ prob, sla }: { prob: number; sla: number }) {
  const pct = Math.round(prob * 100);
  const color = prob >= 0.9 ? "bg-emerald-500" : prob >= 0.6 ? "bg-orange-500" : "bg-rose-500";
  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between text-[10px] text-slate-500">
        <span>
          On-time · P(≤ {sla}d)
        </span>
        <span className="font-semibold tabular-nums text-slate-300">{pct}%</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StochasticReport() {
  const dataset = useAppStore((s) => s.dataset);
  const nodesById = useAppStore((s) => s.nodesById);
  const stochastic = useAppStore((s) => s.stochastic);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const sla = useAppStore((s) => s.sla);
  const highlightPath = useAppStore((s) => s.highlightPath);
  const highlightedPath = useAppStore((s) => s.highlightedPath);
  const setOriginChoice = useAppStore((s) => s.setOriginChoice);
  const routeSummary = useRouteSummary();

  const { supplier, focusSupplierId, origins, routing, baseBest } = useStochasticFocus();

  if (!dataset || !stochastic || !focusSupplierId) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-500">
        Sampling scenarios…
      </div>
    );
  }
  if (!routing) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" data-testid="stochastic-report">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Route className="h-3.5 w-3.5 text-violet-400" />
        Top {Math.min(3, routing.paths.length)} Pathways · {policyLabel(stochastic.policy)}
      </h3>
      <p className="mt-1 text-[11px] text-slate-500">
        {supplier?.supplierName ?? focusSupplierId}
        {!selectedNodeId && <span className="ml-1 text-orange-400/80">(highest tail-risk shift)</span>}
      </p>

      {origins.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {origins.map((o) => {
            const label =
              nodesById.get(o.originNodeId)?.label.split("—")[0].trim() ?? o.originNodeId;
            const active = o.originNodeId === routing.originNodeId;
            return (
              <button
                key={o.originNodeId}
                onClick={() => setOriginChoice(focusSupplierId, o.originNodeId)}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  active
                    ? "border-violet-500/60 bg-violet-500/15 text-violet-300"
                    : "border-slate-700 text-slate-400 hover:border-slate-500"
                }`}
              >
                {label} · {o.sharePct}%
              </button>
            );
          })}
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {routing.paths.map((p, i) => (
          <StochasticPathCard
            key={p.edgeIds.join()}
            path={p}
            rank={i}
            sla={sla}
            n={stochastic.n}
            baseline={baseBest}
            segments={routeSummary(p)}
            highlighted={highlightedPath?.edgeIds.join() === p.edgeIds.join()}
            onToggle={(on) =>
              highlightPath(on ? { nodeIds: p.nodeIds, edgeIds: p.edgeIds } : null)
            }
          />
        ))}
      </ol>
    </div>
  );
}

function policyLabel(policy: string): string {
  return { expected: "Expected", p95: "P95", cvar95: "CVaR₉₅", onTime: "On-time" }[policy] ?? policy;
}

function StochasticPathCard({
  path,
  rank,
  sla,
  n,
  baseline,
  segments,
  highlighted,
  onToggle,
}: {
  path: StochasticPathResult;
  rank: number;
  sla: number;
  n: number;
  baseline?: StochasticPathResult;
  segments: string[];
  highlighted: boolean;
  onToggle: (on: boolean) => void;
}) {
  const s = path.stats;
  // Conservative CI half-width for the mean delta (ignores CRN covariance,
  // so the true interval is tighter).
  const deltaMean = baseline ? s.mean - baseline.stats.mean : 0;
  const ciHalf = baseline
    ? Math.round(
        ((1.645 * Math.sqrt(s.stdev ** 2 + baseline.stats.stdev ** 2)) / Math.sqrt(n)) * 10,
      ) / 10
    : 0;

  return (
    <li>
      <button
        onClick={() => onToggle(!highlighted)}
        className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
          highlighted
            ? "border-violet-500/60 bg-violet-500/10"
            : "border-slate-800 bg-slate-950/50 hover:border-slate-600"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-200">
            Path {rank + 1}
            {rank === 0 && (
              <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                RECOMMENDED
              </span>
            )}
          </span>
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${riskBadgeClasses(
              Math.min(1, Math.max(0, (s.p95 / Math.max(1e-9, s.p50) - 1) / 2)),
            )}`}
          >
            CVaR₉₅ {s.cvar95.toFixed(1)}d
          </span>
        </div>

        <RouteBreadcrumb segments={segments} />
        <HistogramStrip stats={s} />

        <div className="mt-1.5 grid grid-cols-4 gap-1 text-center text-[10px] tabular-nums">
          {(
            [
              ["mean", s.mean],
              ["P50", s.p50],
              ["P90", s.p90],
              ["P95", s.p95],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded bg-slate-900/80 px-1 py-0.5">
              <div className="text-slate-500">{label}</div>
              <div className="font-semibold text-slate-200">{v.toFixed(1)}d</div>
            </div>
          ))}
        </div>

        <OnTimeGauge prob={s.onTimeProb} sla={sla} />

        <div className="mt-1.5 flex items-center gap-3 border-t border-slate-800/80 pt-1.5 text-[10px] tabular-nums text-slate-400">
          {baseline && Math.abs(deltaMean) > 0.05 ? (
            <span
              className={`inline-flex items-center gap-0.5 ${
                deltaMean > 0 ? "text-orange-400" : "text-emerald-400"
              }`}
            >
              {deltaMean > 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {fmtDelta(deltaMean)} ± {ciHalf}d vs pre-disruption
            </span>
          ) : (
            <span className="text-slate-500">at pre-disruption baseline</span>
          )}
          <span className="ml-auto text-slate-500">freight {path.totalFreightCost.toFixed(0)}u</span>
        </div>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Deterministic report (unchanged behavior)
// ---------------------------------------------------------------------------

function DeterministicReport() {
  const dataset = useAppStore((s) => s.dataset);
  const nodesById = useAppStore((s) => s.nodesById);
  const routings = useAppStore((s) => s.routings);
  const baselineRoutings = useAppStore((s) => s.baselineRoutings);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const severity = useAppStore((s) => s.regionSeverity);
  const highlightPath = useAppStore((s) => s.highlightPath);
  const highlightedPath = useAppStore((s) => s.highlightedPath);
  const routeSummary = useRouteSummary();

  const baselineBySupplier = useMemo(
    () => new Map(baselineRoutings.map((r) => [r.supplierId, r])),
    [baselineRoutings],
  );

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
          const isHighlighted = highlightedPath?.edgeIds.join() === p.edgeIds.join();
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

                <RouteBreadcrumb segments={routeSummary(p)} />

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

export default function AltPathsReport() {
  const engineMode = useAppStore((s) => s.engineMode);
  return engineMode === "stochastic" ? <StochasticReport /> : <DeterministicReport />;
}
