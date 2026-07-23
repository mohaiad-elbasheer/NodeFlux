# NodeFlux — Low-Code Macro Supply Chain Positioning (Beta)

NodeFlux is a lightweight analyst workbench for macro supply-chain positioning in the
**High-Tech Retail & Electronics** sector (HS Chapter 85). Upload a plain CSV/Excel of
Tier-1 suppliers and get:

- **Automated enrichment** — offline geocoding plus mock UN-Comtrade-derived Tier-2
  dependency risks (e.g. a German supplier is auto-tagged *"Sourcing 75% Polysilicon
  from East Asia Hub"*).
- **Dual visualization** — a geospatial risk map (Leaflet) and a relational dependency
  DAG (React Flow) with bidirectional cross-highlighting.
- **Two engines, one toggle** — a **Deterministic** mode (edge weight
  `lead_time × (1 + macro_risk) + freight`, Dijkstra + Yen's K-shortest paths) and a
  genuinely **Stochastic** mode: PERT leg lead-time distributions, a one-factor
  regional common-shock disruption model, and a seeded Monte Carlo evaluator that
  reports P50/P90/P95, CVaR₉₅, and on-time probability against an SLA.
- **Risk-policy routing** — rank alternative pathways by Expected, P95 (risk-averse),
  CVaR₉₅, or On-time probability; sliders drive disruption *probability and magnitude*,
  and pathways reroute live.
- **Analyst report** — Top-3 pathways with distribution histograms, quantile grids,
  on-time gauges, lead-time deltas (± CI), vulnerability scores, and avoided-bottleneck
  narratives.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Click **Load sample electronics portfolio** or drop your own file with columns:

```
Supplier_Name, Country_of_Origin, City, Product_Description,
HS_Code_Chapter_85, Estimated_Lead_Time_Days
```

Header matching is case/punctuation-insensitive and every field has a safe default —
malformed rows produce warnings, never crashes.

## Architecture

| Layer | Implementation |
| --- | --- |
| Ingestion | `POST /api/ingest` (CSV via papaparse, XLSX via exceljs), locale-aware numeric parsing |
| Geocoding | Offline gazetteer (`data/gazetteer.ts`), country-centroid fallback |
| Enrichment | Country → Tier-2 dependency rules (`data/comtrade-seed.ts`) |
| Graph | Pure-TS DAG builder: origins → ports/chokepoints → Tier-1 → DC, distance-derived legs (`lib/graph/build.ts`) |
| Deterministic engine | Dijkstra + Yen's K-shortest paths (`lib/graph/engine.ts`) |
| Stochastic engine | Seeded RNG + PERT/lognormal + common-shock Monte Carlo (`lib/stochastic/*`), policy-ranked routing (`lib/graph/stochastic-routing.ts`) — full spec in [`docs/MODEL.md`](docs/MODEL.md) |
| Compute | Monte Carlo runs in a Web Worker with progressive refinement (`lib/workers/mc.worker.ts`) |
| State | zustand store, debounced/throttled recompute, worker orchestration (`lib/store.ts`) |
| Persistence | In-memory + versioned JSON snapshot (`.nodeflux/snapshot.json`) — beta scope, no DB |
| UI | Next.js App Router, Tailwind CSS, Lucide, react-leaflet, @xyflow/react |

The edge-weight model, per the spec:

```
Edge_Weight = Base_Lead_Time * (1 + Macro_Risk_Modifier) + Static_Freight_Cost
Macro_Risk_Modifier = baseline zone risk + bottleneck slider severity (region-scoped)
```

## Verification

```bash
npm test              # csv + engine + stochastic unit/statistical suites
npm run build && npm run start -- -p 3100
npm run verify:ui     # all four browser suites (dual-view, simulation, e2e, stochastic)
```

Individual suites: `scripts/verify-ui.mjs` (dual-view + cross-highlight),
`verify-simulation.mjs` (slider → recolor → reroute), `verify-e2e.mjs`
(upload → simulate → report), `verify-stochastic.mjs` (MC mode, policy
rerouting, SLA reactivity, seed reproducibility).

Browser scripts need Playwright's Chromium; set `CHROMIUM_PATH` to point at a local
Chromium binary (CI does this automatically — see `.github/workflows/ci.yml`).

## Beta limitations / production roadmap

- Comtrade enrichment, risk zones, freight costs, **and all stochastic model
  parameters** are **seeded stubs** — none are fitted to data. Every parameter has a
  calibration TODO in [`docs/MODEL.md`](docs/MODEL.md); swap `data/*.ts` and the
  `MODEL_PARAMS`/`MODE_PARAMS` tables for live feeds (UN Comtrade API, GDACS storm
  tracks, port-congestion indices, carrier transit-time histories). Treat absolute day
  counts as illustrative; relative comparisons are the meaningful output at this stage.
- Correlation is **single-factor** (one shock per region): no cross-region contagion or
  global common factor yet. No **recourse** (adaptive mid-route rerouting / MDP) — the
  model gives fixed-path distributions. Both are explicit backlog items.
- Single shared dataset (last upload wins); no auth/multi-tenancy.
- The in-memory graph is the right scale for hundreds of nodes; a property-graph
  database (Neo4j/Memgraph) becomes worthwhile for million-edge Tier-N networks and
  multi-hop exposure queries.

## Sprint history

- **Beta (Phases 1–4):** ingestion, dual view, deterministic simulation, pathway report.
- **Sprint 01 (stochastic):** QC remediation (locale parsing, security, deterministic
  leg model, CI) + a genuinely stochastic engine (Monte Carlo, PERT distributions,
  regional correlation, risk-policy routing, Web Worker performance, uncertainty UI).
  See [`docs/SPRINT-01-STOCHASTICITY.md`](docs/SPRINT-01-STOCHASTICITY.md) and
  [`docs/MODEL.md`](docs/MODEL.md).
