// Monte Carlo Web Worker: holds the dataset and runs the full
// candidates -> portfolio-MC -> policy-ranking pipeline off the UI thread.

import { computeStochasticRoutings } from "../graph/stochastic-routing";
import type { RiskPolicy, StochasticOptions } from "../stochastic/model";
import type { RegionSeverity, SupplyChainGraph, SupplierRow } from "../types";

export interface McInitMessage {
  type: "init";
  graph: SupplyChainGraph;
  suppliers: SupplierRow[];
}

export interface McEvaluateMessage {
  type: "evaluate";
  requestId: number;
  severity: RegionSeverity;
  policy: RiskPolicy;
  options: Partial<StochasticOptions>;
}

export type McRequest = McInitMessage | McEvaluateMessage;

let graph: SupplyChainGraph | null = null;
let suppliers: SupplierRow[] = [];

self.onmessage = (e: MessageEvent<McRequest>) => {
  const msg = e.data;
  if (msg.type === "init") {
    graph = msg.graph;
    suppliers = msg.suppliers;
    return;
  }
  if (msg.type === "evaluate") {
    if (!graph) {
      self.postMessage({ type: "error", requestId: msg.requestId, error: "not initialized" });
      return;
    }
    try {
      const result = computeStochasticRoutings(
        graph,
        suppliers,
        msg.severity,
        msg.policy,
        msg.options,
      );
      self.postMessage({ type: "result", requestId: msg.requestId, result });
    } catch (err) {
      self.postMessage({ type: "error", requestId: msg.requestId, error: String(err) });
    }
  }
};
