"use client";

// Low-code simulation controls: engine mode (deterministic | stochastic),
// risk policy + SLA (stochastic), bottleneck region picker and severity
// slider. Severity flows straight into the store (instant edge recolor);
// heavy recomputation is debounced/throttled inside the store.

import { useState } from "react";
import { Dices, RotateCcw, SlidersHorizontal, Waves } from "lucide-react";
import { MC_N_REFINED, MC_SEED, useAppStore } from "@/lib/store";
import { RISK_POLICIES } from "@/lib/stochastic/model";

export default function SimulationPanel() {
  const dataset = useAppStore((s) => s.dataset);
  const severity = useAppStore((s) => s.regionSeverity);
  const setSeverity = useAppStore((s) => s.setSeverity);
  const resetSeverity = useAppStore((s) => s.resetSeverity);
  const engineMode = useAppStore((s) => s.engineMode);
  const setEngineMode = useAppStore((s) => s.setEngineMode);
  const riskPolicy = useAppStore((s) => s.riskPolicy);
  const setRiskPolicy = useAppStore((s) => s.setRiskPolicy);
  const sla = useAppStore((s) => s.sla);
  const setSla = useAppStore((s) => s.setSla);
  const samplingState = useAppStore((s) => s.samplingState);
  const stochastic = useAppStore((s) => s.stochastic);

  const regions = Array.from(
    new Set(
      (dataset?.graph.nodes ?? [])
        .map((n) => n.region)
        .filter((r): r is string => !!r),
    ),
  ).sort();

  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const region = activeRegion ?? regions[0] ?? null;
  const value = region ? Math.round((severity[region] ?? 0) * 100) : 0;
  const anyActive = Object.values(severity).some((v) => v > 0);
  const stochasticOn = engineMode === "stochastic";

  if (!dataset) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
          Bottleneck Simulation
        </h3>
        {anyActive && (
          <button
            onClick={resetSeverity}
            className="flex items-center gap-1 text-[10px] font-medium text-slate-500 transition-colors hover:text-sky-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </button>
        )}
      </div>

      {/* Engine mode toggle (S-4.1) */}
      <div className="mt-3 flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5">
        {(
          [
            { id: "deterministic", label: "Deterministic", icon: Waves },
            { id: "stochastic", label: "Stochastic", icon: Dices },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            data-testid={`engine-${m.id}`}
            onClick={() => setEngineMode(m.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
              engineMode === m.id
                ? "bg-sky-500/20 text-sky-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
      </div>

      {stochasticOn && (
        <div className="mt-3 space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Rank pathways by
            </p>
            <div className="flex flex-wrap gap-1">
              {RISK_POLICIES.map((p) => (
                <button
                  key={p.id}
                  title={p.hint}
                  data-testid={`policy-${p.id}`}
                  onClick={() => setRiskPolicy(p.id)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    riskPolicy === p.id
                      ? "border-violet-500/60 bg-violet-500/15 text-violet-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between text-[11px] text-slate-400">
            <span>On-time SLA (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={sla}
              onChange={(e) => setSla(Number(e.target.value))}
              className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right text-xs text-slate-200 outline-none focus:border-sky-500/60"
            />
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {regions.map((r) => {
          const pct = Math.round((severity[r] ?? 0) * 100);
          const active = r === region;
          return (
            <button
              key={r}
              onClick={() => setActiveRegion(r)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                active
                  ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
                  : pct > 0
                    ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                    : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500"
              }`}
            >
              {r}
              {pct > 0 && <span className="ml-1 font-bold">{pct}%</span>}
            </button>
          );
        })}
      </div>

      {region && (
        <div className="mt-4">
          <label
            htmlFor="severity-slider"
            className="flex items-baseline justify-between text-[11px] text-slate-400"
          >
            <span>
              Simulate Infrastructure/Port Bottleneck Severity —{" "}
              <span className="font-semibold text-slate-200">{region}</span>
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${
                value > 50 ? "text-rose-400" : value > 15 ? "text-orange-400" : "text-emerald-400"
              }`}
            >
              {value}%
            </span>
          </label>
          <input
            id="severity-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => setSeverity(region, Number(e.target.value) / 100)}
            className="mt-2 w-full"
            aria-label={`Bottleneck severity for ${region}`}
          />
          <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-slate-600">
            <span>Free flow</span>
            <span>Congested</span>
            <span>Blocked</span>
          </div>
        </div>
      )}

      {stochasticOn ? (
        <p
          data-testid="mc-footer"
          className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500"
        >
          {stochasticOn && severityNote(anyActive)} Monte Carlo:{" "}
          <span className="font-mono text-slate-400">
            seed {MC_SEED} · N={stochastic?.n ?? MC_N_REFINED}
          </span>{" "}
          ·{" "}
          {samplingState === "live"
            ? "sampling…"
            : samplingState === "refined"
              ? "refined"
              : "idle"}{" "}
          · reproducible run
        </p>
      ) : (
        anyActive && (
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500">
            Macro-risk modifiers are live: affected edges re-weight as{" "}
            <span className="font-mono text-slate-400">
              lead&nbsp;time × (1 + risk) + freight
            </span>{" "}
            and pathways below re-optimize automatically.
          </p>
        )
      )}
    </div>
  );
}

function severityNote(anyActive: boolean): string {
  return anyActive
    ? "Sliders now drive disruption probability and magnitude per region."
    : "";
}
