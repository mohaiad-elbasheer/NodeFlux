"use client";

// Inspector card for the currently selected node (richest for suppliers:
// shows the injected Tier-2 dependency risks from the enrichment layer).

import { AlertTriangle, MapPin, PackageSearch, Timer } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { riskBadgeClasses, riskLabel } from "@/lib/utils";

export default function SupplierDetail() {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const nodesById = useAppStore((s) => s.nodesById);
  const dataset = useAppStore((s) => s.dataset);
  const severity = useAppStore((s) => s.regionSeverity);

  const node = selectedNodeId ? nodesById.get(selectedNodeId) : undefined;
  if (!node) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-500">
        Select a node on the map or graph to inspect it.
      </div>
    );
  }

  const supplier = node.supplierId
    ? dataset?.suppliers.find((s) => s.id === node.supplierId)
    : undefined;
  const eff = Math.min(
    2.5,
    node.baselineRisk + (node.region ? (severity[node.region] ?? 0) : 0),
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{node.label}</h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskBadgeClasses(eff)}`}
        >
          {riskLabel(eff)} risk
        </span>
      </div>

      <div className="mt-2 space-y-1.5 text-xs text-slate-400">
        <p className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-slate-500" />
          {supplier
            ? `${supplier.city || "—"}, ${supplier.countryOfOrigin || "—"}`
            : node.region ?? `${node.lat.toFixed(2)}, ${node.lng.toFixed(2)}`}
          {supplier?.geocodeApproximate && (
            <span className="text-slate-600">(approx.)</span>
          )}
        </p>
        {supplier && (
          <>
            <p className="flex items-center gap-1.5">
              <PackageSearch className="h-3.5 w-3.5 text-slate-500" />
              {supplier.productDescription} · HS {supplier.hsCodeChapter85}
            </p>
            <p className="flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 text-slate-500" />
              Estimated lead time: {supplier.estimatedLeadTimeDays} days
            </p>
          </>
        )}
      </div>

      {supplier && supplier.tier2Dependencies.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Tier-2 dependency risks (UN Comtrade seed)
          </p>
          <ul className="space-y-1.5">
            {supplier.tier2Dependencies.map((d) => (
              <li
                key={`${d.originNodeId}-${d.material}`}
                className="flex items-start gap-1.5 text-xs text-slate-300"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                {d.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {supplier && supplier.warnings.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Ingestion notes
          </p>
          <ul className="space-y-1 text-[11px] text-slate-500">
            {supplier.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
