// Server-side dataset store: in-memory with a JSON snapshot on disk so the
// dataset survives dev-server restarts. Deliberately dependency-free (beta).

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Dataset } from "../types";

const SNAPSHOT_PATH = join(process.cwd(), ".nodeflux", "snapshot.json");

/** Bump when Dataset/graph shapes change; stale snapshots are discarded. */
export const SCHEMA_VERSION = 2;

// Survive Next.js dev-mode module reloads by hanging state off globalThis.
const g = globalThis as unknown as { __nodefluxDataset?: Dataset | null };

export function saveDataset(dataset: Dataset): void {
  g.__nodefluxDataset = dataset;
  try {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(dataset));
  } catch (err) {
    // Snapshot is a nicety; in-memory copy remains authoritative.
    console.warn("nodeflux: failed to write snapshot:", err);
  }
}

export function loadDataset(): Dataset | null {
  if (g.__nodefluxDataset) return g.__nodefluxDataset;
  try {
    const raw = readFileSync(SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Dataset | null;
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return null;
    g.__nodefluxDataset = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDataset(): void {
  g.__nodefluxDataset = null;
  try {
    writeFileSync(SNAPSHOT_PATH, "null");
  } catch {
    /* ignore */
  }
}
