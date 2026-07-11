"use client";

// Low-code simulation controls: pick a bottleneck region, drag the severity
// slider. Severity flows straight into the store (instant edge recolor);
// the K-shortest-path recompute is debounced inside the store.

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useAppStore } from "@/lib/store";

export default function SimulationPanel() {
  const dataset = useAppStore((s) => s.dataset);
  const severity = useAppStore((s) => s.regionSeverity);
  const setSeverity = useAppStore((s) => s.setSeverity);
  const resetSeverity = useAppStore((s) => s.resetSeverity);

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

      {anyActive && (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500">
          Macro-risk modifiers are live: affected edges re-weight as{" "}
          <span className="font-mono text-slate-400">
            lead&nbsp;time × (1 + risk) + freight
          </span>{" "}
          and pathways below re-optimize automatically.
        </p>
      )}
    </div>
  );
}
