"use client";

// NodeFlux analyst workspace: header + dual-canvas + right-hand analyst rail.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Network,
  RefreshCcw,
  Upload,
} from "lucide-react";
import SplitView, { ViewModeSwitch } from "@/components/layout/SplitView";
import UploadDropzone from "@/components/UploadDropzone";
import SupplierDetail from "@/components/SupplierDetail";
import SimulationPanel from "@/components/SimulationPanel";
import AltPathsReport from "@/components/AltPathsReport";
import { useAppStore } from "@/lib/store";

function WarningsBanner() {
  const dataset = useAppStore((s) => s.dataset);
  const [open, setOpen] = useState(false);
  const warnings = dataset?.warnings ?? [];
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
      <button
        className="flex w-full items-center gap-1.5 font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        {warnings.length} ingestion warning{warnings.length > 1 ? "s" : ""}
        {open ? (
          <ChevronUp className="ml-auto h-3 w-3" />
        ) : (
          <ChevronDown className="ml-auto h-3 w-3" />
        )}
      </button>
      {open && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-amber-200/80">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Home() {
  const dataset = useAppStore((s) => s.dataset);
  const hydrate = useAppStore((s) => s.hydrate);
  const ingestFile = useAppStore((s) => s.ingestFile);
  const loading = useAppStore((s) => s.loading);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      <header className="flex shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-950/95 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-sky-500/15 p-1.5">
            <Network className="h-5 w-5 text-sky-400" />
          </span>
          <div>
            <h1 className="text-sm font-bold leading-tight tracking-tight">
              NodeFlux
              <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                Beta
              </span>
            </h1>
            <p className="text-[10px] leading-tight text-slate-500">
              Macro Supply Chain Positioning · High-Tech Retail & Electronics (HS 85)
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {dataset && (
            <>
              <p className="hidden text-[11px] text-slate-500 md:block">
                {dataset.sourceFileName} · {dataset.suppliers.length} suppliers ·{" "}
                {dataset.graph.nodes.length} nodes / {dataset.graph.edges.length} edges
              </p>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-sky-500/60 hover:text-sky-300">
                {loading ? (
                  <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Re-upload
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void ingestFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <ViewModeSwitch />
            </>
          )}
        </div>
      </header>

      {!dataset ? (
        <main className="min-h-0 flex-1">
          <UploadDropzone />
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 gap-1.5 p-1.5">
          <section className="flex min-w-0 flex-1 flex-col gap-1.5">
            <WarningsBanner />
            <div className="min-h-0 flex-1">
              <SplitView />
            </div>
          </section>

          <aside className="flex w-80 shrink-0 flex-col gap-1.5 overflow-y-auto">
            <SimulationPanel />
            <AltPathsReport />
            <SupplierDetail />
          </aside>
        </main>
      )}
    </div>
  );
}
