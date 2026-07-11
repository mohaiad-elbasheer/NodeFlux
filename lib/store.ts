"use client";

// Client state: dataset, cross-canvas selection, simulation severity, and
// computed routings. Severity updates apply instantly (edges recolor via a
// cheap derived pass) while the K-shortest-path recomputation is debounced
// so slider drags stay smooth.

import { create } from "zustand";
import { computeRoutings } from "./graph/engine";
import { debounce } from "./utils";
import type {
  Dataset,
  GraphNode,
  RegionSeverity,
  SupplierRouting,
} from "./types";

export type ViewMode = "split" | "map" | "graph";

interface AppState {
  dataset: Dataset | null;
  nodesById: Map<string, GraphNode>;
  loading: boolean;
  error: string | null;

  selectedNodeId: string | null;
  highlightedPath: { nodeIds: string[]; edgeIds: string[] } | null;
  viewMode: ViewMode;

  regionSeverity: RegionSeverity;
  /** Live routings under current severity (debounced recompute). */
  routings: SupplierRouting[];
  /** Zero-severity reference routings for delta comparisons. */
  baselineRoutings: SupplierRouting[];

  hydrate: () => Promise<void>;
  ingestFile: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  clearError: () => void;
  select: (nodeId: string | null) => void;
  highlightPath: (path: { nodeIds: string[]; edgeIds: string[] } | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSeverity: (region: string, value: number) => void;
  resetSeverity: () => void;
}

function indexNodes(dataset: Dataset | null): Map<string, GraphNode> {
  return new Map((dataset?.graph.nodes ?? []).map((n) => [n.id, n]));
}

export const useAppStore = create<AppState>((set, get) => {
  const recompute = () => {
    const { dataset, regionSeverity } = get();
    if (!dataset) return;
    set({ routings: computeRoutings(dataset.graph, dataset.suppliers, regionSeverity) });
  };
  const recomputeDebounced = debounce(recompute, 150);

  const applyDataset = (dataset: Dataset) => {
    const baseline = computeRoutings(dataset.graph, dataset.suppliers, {});
    set({
      dataset,
      nodesById: indexNodes(dataset),
      regionSeverity: {},
      routings: baseline,
      baselineRoutings: baseline,
      selectedNodeId: null,
      highlightedPath: null,
      error: null,
    });
  };

  const ingestResponse = async (res: Response) => {
    const body = await res.json();
    if (!res.ok) {
      const warn = Array.isArray(body.warnings) && body.warnings.length > 0
        ? ` (${body.warnings[0]})`
        : "";
      throw new Error((body.error ?? "Upload failed.") + warn);
    }
    applyDataset(body as Dataset);
  };

  return {
    dataset: null,
    nodesById: new Map(),
    loading: false,
    error: null,
    selectedNodeId: null,
    highlightedPath: null,
    viewMode: "split",
    regionSeverity: {},
    routings: [],
    baselineRoutings: [],

    hydrate: async () => {
      set({ loading: true });
      try {
        const res = await fetch("/api/graph");
        if (res.ok) applyDataset((await res.json()) as Dataset);
      } catch {
        /* no dataset yet — the empty state handles it */
      } finally {
        set({ loading: false });
      }
    },

    ingestFile: async (file: File) => {
      set({ loading: true, error: null });
      try {
        const form = new FormData();
        form.append("file", file);
        await ingestResponse(await fetch("/api/ingest", { method: "POST", body: form }));
      } catch (err) {
        set({ error: err instanceof Error ? err.message : "Upload failed." });
      } finally {
        set({ loading: false });
      }
    },

    loadSample: async () => {
      set({ loading: true, error: null });
      try {
        const csv = await fetch("/sample-suppliers.csv").then((r) => r.blob());
        const file = new File([csv], "sample-suppliers.csv", { type: "text/csv" });
        const form = new FormData();
        form.append("file", file);
        await ingestResponse(await fetch("/api/ingest", { method: "POST", body: form }));
      } catch (err) {
        set({ error: err instanceof Error ? err.message : "Failed to load sample data." });
      } finally {
        set({ loading: false });
      }
    },

    clearError: () => set({ error: null }),

    select: (nodeId) => set({ selectedNodeId: nodeId, highlightedPath: null }),

    highlightPath: (path) => set({ highlightedPath: path }),

    setViewMode: (mode) => set({ viewMode: mode }),

    setSeverity: (region, value) => {
      const next = { ...get().regionSeverity, [region]: value };
      if (value === 0) delete next[region];
      set({ regionSeverity: next });
      recomputeDebounced();
    },

    resetSeverity: () => {
      set({ regionSeverity: {} });
      recompute();
    },
  };
});
