"use client";

// Dual-canvas shell: side-by-side map + graph with a segmented control to
// maximize either canvas. Leaflet must never render on the server, so the
// map is dynamically imported here with ssr disabled.

import dynamic from "next/dynamic";
import { GitBranch, Globe2, Loader2 } from "lucide-react";
import DependencyGraph from "@/components/DependencyGraph";
import { useAppStore, type ViewMode } from "@/lib/store";

const GeoMap = dynamic(() => import("@/components/GeoMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-slate-500">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

function CanvasHeader({ icon: Icon, title, subtitle }: {
  icon: typeof Globe2;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-950/80 px-3 py-1.5 backdrop-blur">
      <Icon className="h-3.5 w-3.5 text-sky-400" />
      <div>
        <p className="text-[11px] font-semibold leading-tight text-slate-200">{title}</p>
        <p className="text-[10px] leading-tight text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

export function ViewModeSwitch() {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const options: { id: ViewMode; label: string }[] = [
    { id: "map", label: "Map" },
    { id: "split", label: "Split" },
    { id: "graph", label: "Graph" },
  ];
  return (
    <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => setViewMode(o.id)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === o.id
              ? "bg-sky-500/20 text-sky-300"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SplitView() {
  const viewMode = useAppStore((s) => s.viewMode);

  return (
    <div className="flex h-full min-h-0 gap-1.5">
      {viewMode !== "graph" && (
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800">
          <CanvasHeader
            icon={Globe2}
            title="Geospatial Risk Map"
            subtitle="Tier-1 pins · climate & infrastructure heat zones"
          />
          <GeoMap />
        </div>
      )}
      {viewMode !== "map" && (
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
          <CanvasHeader
            icon={GitBranch}
            title="Dependency Network"
            subtitle="Raw material → trade route → Tier-1 → DC"
          />
          <DependencyGraph />
        </div>
      )}
    </div>
  );
}
