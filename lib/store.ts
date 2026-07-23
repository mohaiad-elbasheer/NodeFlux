"use client";

// Client state: dataset, cross-canvas selection, simulation severity, and
// computed routings — deterministic and stochastic. Severity updates apply
// instantly (edges recolor via a cheap derived pass); the deterministic
// recompute is debounced at 150 ms; stochastic Monte Carlo runs in a Web
// Worker with a throttled 200-sample live pass during drags and a debounced
// 2,000-sample refinement on settle (S-3).

import { create } from "zustand";
import { computeRoutings } from "./graph/engine";
import type { StochasticComputation } from "./graph/stochastic-routing";
import { McClient } from "./stochastic/client";
import type { RiskPolicy } from "./stochastic/model";
import { debounce } from "./utils";
import type {
  Dataset,
  GraphNode,
  RegionSeverity,
  SupplierRouting,
} from "./types";

export type ViewMode = "split" | "map" | "graph";
export type EngineMode = "deterministic" | "stochastic";

export const MC_SEED = 42;
export const MC_N_LIVE = 200;
export const MC_N_REFINED = 2000;
const LIVE_THROTTLE_MS = 120;
const REFINE_DEBOUNCE_MS = 300;

interface AppState {
  dataset: Dataset | null;
  nodesById: Map<string, GraphNode>;
  loading: boolean;
  error: string | null;

  selectedNodeId: string | null;
  highlightedPath: { nodeIds: string[]; edgeIds: string[] } | null;
  viewMode: ViewMode;

  regionSeverity: RegionSeverity;
  /** Live deterministic routings under current severity (debounced). */
  routings: SupplierRouting[];
  /** Zero-severity reference routings for delta comparisons. */
  baselineRoutings: SupplierRouting[];

  engineMode: EngineMode;
  riskPolicy: RiskPolicy;
  sla: number;
  /** Latest stochastic computation (worker-produced). */
  stochastic: StochasticComputation | null;
  /** Zero-severity stochastic reference for deltas. */
  stochasticBaseline: StochasticComputation | null;
  /** 'live' = quick 200-sample pass; 'refined' = settled 2000-sample pass. */
  samplingState: "idle" | "live" | "refined";

  hydrate: () => Promise<void>;
  ingestFile: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  clearError: () => void;
  select: (nodeId: string | null) => void;
  highlightPath: (path: { nodeIds: string[]; edgeIds: string[] } | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSeverity: (region: string, value: number) => void;
  resetSeverity: () => void;
  setEngineMode: (mode: EngineMode) => void;
  setRiskPolicy: (policy: RiskPolicy) => void;
  setSla: (sla: number) => void;
}

function indexNodes(dataset: Dataset | null): Map<string, GraphNode> {
  return new Map((dataset?.graph.nodes ?? []).map((n) => [n.id, n]));
}

const mcClient = new McClient();

export const useAppStore = create<AppState>((set, get) => {
  const recompute = () => {
    const { dataset, regionSeverity } = get();
    if (!dataset) return;
    set({ routings: computeRoutings(dataset.graph, dataset.suppliers, regionSeverity) });
  };
  const recomputeDebounced = debounce(recompute, 150);

  let lastLiveAt = 0;
  const runStochastic = (n: number, refined: boolean) => {
    const { dataset, engineMode, regionSeverity, riskPolicy, sla } = get();
    if (!dataset || engineMode !== "stochastic") return;
    set({ samplingState: refined ? get().samplingState : "live" });
    mcClient
      .evaluate(regionSeverity, riskPolicy, { n, seed: MC_SEED, sla })
      .then((result) => {
        if (get().engineMode !== "stochastic") return;
        set({ stochastic: result, samplingState: refined ? "refined" : "live" });
      })
      .catch(() => {
        /* superseded or worker fallback errors are non-fatal */
      });
  };
  const refineDebounced = debounce(() => runStochastic(MC_N_REFINED, true), REFINE_DEBOUNCE_MS);

  const kickStochastic = () => {
    const now = Date.now();
    if (now - lastLiveAt >= LIVE_THROTTLE_MS) {
      lastLiveAt = now;
      runStochastic(MC_N_LIVE, false);
    }
    refineDebounced();
  };

  const computeStochasticBaseline = () => {
    const { dataset, riskPolicy, sla } = get();
    if (!dataset) return;
    mcClient
      .evaluate({}, riskPolicy, { n: MC_N_REFINED, seed: MC_SEED, sla })
      .then((result) => set({ stochasticBaseline: result }))
      .catch(() => {});
  };

  const applyDataset = (dataset: Dataset) => {
    const baseline = computeRoutings(dataset.graph, dataset.suppliers, {});
    mcClient.init(dataset);
    set({
      dataset,
      nodesById: indexNodes(dataset),
      regionSeverity: {},
      routings: baseline,
      baselineRoutings: baseline,
      stochastic: null,
      stochasticBaseline: null,
      samplingState: "idle",
      selectedNodeId: null,
      highlightedPath: null,
      error: null,
    });
    if (get().engineMode === "stochastic") {
      computeStochasticBaseline();
      runStochastic(MC_N_REFINED, true);
    }
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
    engineMode: "deterministic",
    riskPolicy: "p95",
    sla: 30,
    stochastic: null,
    stochasticBaseline: null,
    samplingState: "idle",

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
      kickStochastic();
    },

    resetSeverity: () => {
      set({ regionSeverity: {} });
      recompute();
      if (get().engineMode === "stochastic") runStochastic(MC_N_REFINED, true);
    },

    setEngineMode: (mode) => {
      set({ engineMode: mode });
      if (mode === "stochastic") {
        if (!get().stochasticBaseline) computeStochasticBaseline();
        runStochastic(MC_N_REFINED, true);
      }
    },

    setRiskPolicy: (policy) => {
      set({ riskPolicy: policy });
      computeStochasticBaseline();
      runStochastic(MC_N_REFINED, true);
    },

    setSla: (sla) => {
      set({ sla: Math.max(1, Math.min(365, Math.round(sla))) });
      computeStochasticBaseline();
      runStochastic(MC_N_REFINED, true);
    },
  };
});
