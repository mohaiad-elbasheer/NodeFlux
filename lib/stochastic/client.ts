"use client";

// Client handle for the Monte Carlo worker. Falls back to synchronous
// main-thread evaluation when Workers are unavailable (tests, old browsers).
// Stale responses are dropped by request id so only the newest evaluation
// ever lands in the store.

import { computeStochasticRoutings, type StochasticComputation } from "../graph/stochastic-routing";
import type { RiskPolicy, StochasticOptions } from "./model";
import type { Dataset, RegionSeverity } from "../types";

export class McClient {
  private worker: Worker | null = null;
  private workerBroken = false;
  private requestId = 0;
  private pending = new Map<
    number,
    { resolve: (r: StochasticComputation) => void; reject: (e: Error) => void }
  >();
  private dataset: Dataset | null = null;

  private ensureWorker(): Worker | null {
    if (this.workerBroken || typeof window === "undefined" || typeof Worker === "undefined") {
      return null;
    }
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL("../workers/mc.worker.ts", import.meta.url));
        this.worker.onmessage = (
          e: MessageEvent<{ type: string; requestId: number; result?: StochasticComputation; error?: string }>,
        ) => {
          const p = this.pending.get(e.data.requestId);
          if (!p) return; // superseded request
          this.pending.delete(e.data.requestId);
          if (e.data.type === "result" && e.data.result) p.resolve(e.data.result);
          else p.reject(new Error(e.data.error ?? "worker error"));
        };
        this.worker.onerror = () => {
          this.workerBroken = true;
          const failed = this.worker;
          this.worker = null;
          failed?.terminate();
          for (const [, p] of this.pending) p.reject(new Error("worker crashed"));
          this.pending.clear();
        };
        if (this.dataset) {
          this.worker.postMessage({
            type: "init",
            graph: this.dataset.graph,
            suppliers: this.dataset.suppliers,
          });
        }
      } catch {
        this.workerBroken = true;
        this.worker = null;
      }
    }
    return this.worker;
  }

  init(dataset: Dataset): void {
    this.dataset = dataset;
    const w = this.ensureWorker();
    w?.postMessage({ type: "init", graph: dataset.graph, suppliers: dataset.suppliers });
  }

  /** Supersedes any in-flight evaluation; stale results never resolve. */
  evaluate(
    severity: RegionSeverity,
    policy: RiskPolicy,
    options: Partial<StochasticOptions>,
  ): Promise<StochasticComputation> {
    const id = ++this.requestId;
    // Drop older pending requests: their results are obsolete.
    for (const [rid, p] of this.pending) {
      if (rid < id) {
        p.reject(new Error("superseded"));
        this.pending.delete(rid);
      }
    }

    const w = this.ensureWorker();
    if (!w) {
      // Synchronous fallback keeps the feature alive without a worker.
      if (!this.dataset) return Promise.reject(new Error("no dataset"));
      return Promise.resolve(
        computeStochasticRoutings(
          this.dataset.graph,
          this.dataset.suppliers,
          severity,
          policy,
          options,
        ),
      );
    }

    return new Promise<StochasticComputation>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type: "evaluate", requestId: id, severity, policy, options });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
