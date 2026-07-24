"use client";

// Shared "focused routing" selector used by both the pathway report and the
// explainability panel, so they always describe the same supplier/origin.
//
// Focus rule: the explicitly selected supplier if it has routings; otherwise
// the supplier whose recommended path's P95 lead time degraded most vs the
// zero-severity baseline (i.e. the one the current simulation hurts most).

import { useMemo } from "react";
import { useAppStore } from "./store";
import type { StochasticRouting } from "./graph/stochastic-routing";
import type { SupplierRow } from "./types";

export interface StochasticFocus {
  supplier: SupplierRow | undefined;
  focusSupplierId: string | undefined;
  /** All Tier-2 origin routings for the focused supplier, share-desc. */
  origins: StochasticRouting[];
  /** The routing currently inspected (origin chip selection or top share). */
  routing: StochasticRouting | undefined;
  /** Zero-severity baseline for the inspected routing's best path. */
  baseBest: StochasticRouting["paths"][number] | undefined;
  /** True when focus was auto-picked (no explicit supplier selection). */
  autoFocus: boolean;
}

export function useStochasticFocus(): StochasticFocus {
  const dataset = useAppStore((s) => s.dataset);
  const stochastic = useAppStore((s) => s.stochastic);
  const baseline = useAppStore((s) => s.stochasticBaseline);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const originChoice = useAppStore((s) => s.originChoice);

  const bySupplier = useMemo(() => {
    const m = new Map<string, StochasticRouting[]>();
    for (const r of stochastic?.routings ?? []) {
      if (!m.has(r.supplierId)) m.set(r.supplierId, []);
      m.get(r.supplierId)!.push(r);
    }
    for (const list of m.values()) list.sort((a, b) => b.sharePct - a.sharePct);
    return m;
  }, [stochastic]);

  const baselineFor = (supplierId: string, originNodeId: string) =>
    baseline?.routings.find(
      (r) => r.supplierId === supplierId && r.originNodeId === originNodeId,
    )?.paths[0];

  const focusSupplierId = useMemo(() => {
    if (selectedNodeId && bySupplier.has(selectedNodeId)) return selectedNodeId;
    let worst: string | undefined;
    let worstDelta = -Infinity;
    for (const [sid, list] of bySupplier) {
      const cur = list[0]?.paths[0];
      const base = list[0] ? baselineFor(sid, list[0].originNodeId) : undefined;
      if (!cur || !base) continue;
      const d = cur.stats.p95 - base.stats.p95;
      if (d > worstDelta) {
        worstDelta = d;
        worst = sid;
      }
    }
    return worst ?? bySupplier.keys().next().value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bySupplier, selectedNodeId, baseline]);

  const origins = focusSupplierId ? bySupplier.get(focusSupplierId) ?? [] : [];
  const chosen = focusSupplierId ? originChoice[focusSupplierId] : undefined;
  const routing = origins.find((o) => o.originNodeId === chosen) ?? origins[0];
  const baseBest =
    routing && focusSupplierId
      ? baselineFor(focusSupplierId, routing.originNodeId)
      : undefined;
  const supplier = dataset?.suppliers.find((s) => s.id === focusSupplierId);

  return {
    supplier,
    focusSupplierId,
    origins,
    routing,
    baseBest,
    autoFocus: !selectedNodeId,
  };
}
