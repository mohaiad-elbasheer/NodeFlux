"use client";

// Explainability panel — answers the analyst's three questions directly:
//   1. WHY is this route recommended?  (policy rationale + KPI comparison)
//   2. WHY is it vulnerable, and to what?  (per-region delay attribution)
//   3. WHAT do the KPIs mean?  (inline glossary)
//
// It describes the highlighted path if the analyst clicked one, otherwise the
// recommended (rank-1) path for the focused supplier/origin.

import { useMemo, useState } from "react";
import { ChevronDown, HelpCircle, Info, Lightbulb } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useStochasticFocus } from "@/lib/useFocus";
import { attributePathDelay } from "@/lib/stochastic/attribution";
import { RISK_POLICIES, type RiskPolicy } from "@/lib/stochastic/model";
import type { StochasticPathResult } from "@/lib/graph/stochastic-routing";

const POLICY_METRIC: Record<RiskPolicy, { key: keyof MetricRow; label: string; lowerBetter: boolean }> = {
  expected: { key: "mean", label: "mean lead time", lowerBetter: true },
  p95: { key: "p95", label: "95th-percentile (P95) lead time", lowerBetter: true },
  cvar95: { key: "cvar95", label: "CVaR₉₅ (worst-5% average)", lowerBetter: true },
  onTime: { key: "onTime", label: "on-time probability", lowerBetter: false },
};

interface MetricRow {
  mean: number;
  p50: number;
  p95: number;
  cvar95: number;
  onTime: number;
  freight: number;
}

function metricsOf(p: StochasticPathResult): MetricRow {
  return {
    mean: p.stats.mean,
    p50: p.stats.p50,
    p95: p.stats.p95,
    cvar95: p.stats.cvar95,
    onTime: p.stats.onTimeProb,
    freight: p.totalFreightCost,
  };
}

const KPI_GLOSSARY: { term: string; def: string }[] = [
  { term: "P50 / P90 / P95", def: "Percentiles of simulated lead time: P95 = only 5% of scenarios finish later. Higher percentile = the planning buffer for that confidence level." },
  { term: "CVaR₉₅", def: "Conditional Value-at-Risk: the average lead time across the worst 5% of scenarios. A tail-risk measure — how bad 'bad' gets." },
  { term: "On-time P(≤ SLA)", def: "Share of simulated scenarios that arrive within your SLA. Your service-level probability under current risk." },
  { term: "Added days by region", def: "Expected extra transit each active bottleneck contributes to this route, from disruption probability × magnitude on the legs it touches." },
  { term: "Freight (u)", def: "Relative freight cost in abstract units; used only to break ties between routes with similar time risk." },
];

function GlossaryRow({ term, def }: { term: string; def: string }) {
  return (
    <div className="flex gap-2 py-1">
      <span className="w-28 shrink-0 font-mono text-[10px] text-slate-400">{term}</span>
      <span className="text-[10px] leading-relaxed text-slate-500">{def}</span>
    </div>
  );
}

function AttributionBar({
  edgeIds,
}: {
  edgeIds: string[];
}) {
  const dataset = useAppStore((s) => s.dataset);
  const severity = useAppStore((s) => s.regionSeverity);

  const attr = useMemo(() => {
    if (!dataset) return null;
    const edgeById = new Map(dataset.graph.edges.map((e) => [e.id, e]));
    const edges = edgeIds.map((id) => edgeById.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
    return attributePathDelay(edges, severity);
  }, [dataset, edgeIds, severity]);

  if (!attr) return null;

  const REGION_COLORS = ["#f97316", "#f43f5e", "#eab308", "#a855f7", "#06b6d4"];
  const segments = [
    { label: "Base transit", days: attr.baseDays, color: "#0ea5e9" },
    ...attr.byRegion.map((r, i) => ({
      label: r.region,
      days: r.days,
      color: REGION_COLORS[i % REGION_COLORS.length],
    })),
    ...(attr.compoundDays > 0.05
      ? [{ label: "Compound", days: attr.compoundDays, color: "#94a3b8" }]
      : []),
  ];
  const total = Math.max(1e-9, attr.totalDays);

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {segments.map((s, i) => (
          <div
            key={i}
            style={{ width: `${(s.days / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.days}d`}
          />
        ))}
      </div>
      <div className="mt-1.5 space-y-0.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums text-slate-300">{s.days.toFixed(1)}d</span>
          </div>
        ))}
      </div>
      {attr.addedDays > 0.05 ? (
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Active bottlenecks add <span className="font-semibold text-orange-300">+{attr.addedDays.toFixed(1)} days</span> of
          expected transit to this route
          {attr.byRegion.length > 0 && (
            <> — driven mostly by <span className="text-slate-300">{attr.byRegion[0].region}</span></>
          )}
          . This is why it carries the risk it does.
        </p>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-emerald-400/80">
          This route touches none of the active bottlenecks — its lead time is unaffected by the current simulation.
        </p>
      )}
    </div>
  );
}

export default function ExplainPanel() {
  const engineMode = useAppStore((s) => s.engineMode);
  const stochastic = useAppStore((s) => s.stochastic);
  const highlightedPath = useAppStore((s) => s.highlightedPath);
  const nodesById = useAppStore((s) => s.nodesById);
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  const { supplier, routing } = useStochasticFocus();

  if (engineMode !== "stochastic" || !stochastic || !routing || routing.paths.length === 0) {
    return null;
  }

  const policy = stochastic.policy;
  const metric = POLICY_METRIC[policy];
  const policyLabel = RISK_POLICIES.find((p) => p.id === policy)?.label ?? policy;

  // Explain the highlighted path if the analyst clicked one; else the winner.
  const explained =
    routing.paths.find((p) => p.edgeIds.join() === highlightedPath?.edgeIds.join()) ??
    routing.paths[0];
  const isRecommended = explained.edgeIds.join() === routing.paths[0].edgeIds.join();
  const winnerVal = metricsOf(routing.paths[0])[metric.key];
  const runnerUp = routing.paths[1];

  const originLabel = nodesById.get(routing.originNodeId)?.label.split("—")[0].trim() ?? "origin";

  // Margin vs the runner-up on the ranked metric, in the metric's own units.
  const marginText = (() => {
    if (!runnerUp) return null;
    const a = metricsOf(routing.paths[0])[metric.key];
    const b = metricsOf(runnerUp)[metric.key];
    if (metric.key === "onTime") {
      return `${Math.round((a - b) * 100)} pts higher on-time chance than the next option`;
    }
    return `${Math.abs(a - b).toFixed(1)}d ${a < b ? "faster" : "slower"} on ${metric.label} than the next option`;
  })();

  return (
    <div className="rounded-xl border border-violet-500/20 bg-slate-900/60 p-4" data-testid="explain-panel">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
        Why this recommendation
      </h3>

      {/* 1. Plain-English rationale */}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
        For <span className="font-semibold">{supplier?.supplierName}</span>, inbound from{" "}
        <span className="font-semibold">{originLabel}</span>, the engine ranks routes by{" "}
        <span className="font-semibold text-violet-300">{policyLabel}</span> — {metric.label}.{" "}
        {isRecommended ? (
          <>
            <span className="font-semibold text-emerald-300">Path 1</span> wins with{" "}
            {metric.key === "onTime"
              ? `${Math.round(Number(winnerVal) * 100)}% on-time`
              : `${Number(winnerVal).toFixed(1)}d`}
            {marginText ? <>, {marginText}.</> : "."}
          </>
        ) : (
          <>You&apos;re inspecting a non-recommended alternative; Path 1 remains the pick under {policyLabel}.</>
        )}
      </p>

      {/* 2. KPI comparison of the candidates */}
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-slate-950/60 text-slate-500">
              <th className="px-2 py-1 text-left font-medium">Path</th>
              {(["mean", "p95", "cvar95", "onTime"] as const).map((k) => (
                <th
                  key={k}
                  className={`px-2 py-1 text-right font-medium ${metric.key === k ? "text-violet-300" : ""}`}
                >
                  {k === "mean" ? "Mean" : k === "p95" ? "P95" : k === "cvar95" ? "CVaR" : "On-time"}
                  {metric.key === k && " ◄"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routing.paths.map((p, i) => {
              const m = metricsOf(p);
              const isWin = i === 0;
              return (
                <tr key={p.edgeIds.join()} className={isWin ? "bg-emerald-500/5" : ""}>
                  <td className="px-2 py-1 font-semibold text-slate-300">
                    P{i + 1}
                    {isWin && <span className="ml-1 text-emerald-400">★</span>}
                  </td>
                  <td className={cell(metric.key === "mean")}>{m.mean.toFixed(1)}</td>
                  <td className={cell(metric.key === "p95")}>{m.p95.toFixed(1)}</td>
                  <td className={cell(metric.key === "cvar95")}>{m.cvar95.toFixed(1)}</td>
                  <td className={cell(metric.key === "onTime")}>{Math.round(m.onTime * 100)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 3. Vulnerability attribution */}
      <div className="mt-3">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Info className="h-3 w-3" />
          Where {isRecommended ? "Path 1" : "this path"}&apos;s lead time comes from
        </p>
        <AttributionBar edgeIds={explained.edgeIds} />
      </div>

      {/* 4. KPI glossary */}
      <button
        onClick={() => setGlossaryOpen((v) => !v)}
        className="mt-3 flex w-full items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-300"
      >
        <HelpCircle className="h-3 w-3" />
        What do these KPIs mean?
        <ChevronDown className={`ml-auto h-3 w-3 transition-transform ${glossaryOpen ? "rotate-180" : ""}`} />
      </button>
      {glossaryOpen && (
        <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
          {KPI_GLOSSARY.map((g) => (
            <GlossaryRow key={g.term} {...g} />
          ))}
        </div>
      )}
    </div>
  );
}

function cell(active: boolean): string {
  return `px-2 py-1 text-right tabular-nums ${active ? "font-semibold text-violet-200" : "text-slate-400"}`;
}
