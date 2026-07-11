# NodeFlux — Low-Code Macro Supply Chain Positioning (Beta)

NodeFlux is a lightweight analyst workbench for macro supply-chain positioning in the
**High-Tech Retail & Electronics** sector (HS Chapter 85). Upload a plain CSV/Excel of
Tier-1 suppliers and get:

- **Automated enrichment** — offline geocoding plus mock UN-Comtrade-derived Tier-2
  dependency risks (e.g. a German supplier is auto-tagged *"Sourcing 75% Polysilicon
  from East Asia Hub"*).
- **Dual visualization** — a geospatial risk map (Leaflet) and a relational dependency
  DAG (React Flow) with bidirectional cross-highlighting.
- **Stochastic simulation** — per-region bottleneck severity sliders re-weight every
  edge as `lead_time × (1 + macro_risk) + freight` and the engine (Dijkstra + Yen's
  K-shortest paths) reroutes pathways live.
- **Analyst report** — Top-3 recommended alternative pathways with lead-time deltas,
  regional vulnerability scores, and avoided-bottleneck narratives.

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
| Ingestion | `POST /api/ingest` (CSV via papaparse, XLSX via SheetJS) |
| Geocoding | Offline gazetteer (`data/gazetteer.ts`), country-centroid fallback |
| Enrichment | Country → Tier-2 dependency rules (`data/comtrade-seed.ts`) |
| Graph | Pure-TS DAG builder: origins → ports/chokepoints → Tier-1 → DC (`lib/graph/build.ts`) |
| Engine | Dijkstra + Yen's K-shortest paths, shared by server & client (`lib/graph/engine.ts`) |
| State | zustand store with debounced (150 ms) simulation recompute (`lib/store.ts`) |
| Persistence | In-memory + JSON snapshot (`.nodeflux/snapshot.json`) — beta scope, no DB |
| UI | Next.js App Router, Tailwind CSS, Lucide, react-leaflet, @xyflow/react |

The edge-weight model, per the spec:

```
Edge_Weight = Base_Lead_Time * (1 + Macro_Risk_Modifier) + Static_Freight_Cost
Macro_Risk_Modifier = baseline zone risk + bottleneck slider severity (region-scoped)
```

## Verification

```bash
npm run test:engine   # engine unit tests (weights, rerouting, K-paths)
npm run build && npm run start -- -p 3100
node scripts/verify-ui.mjs          # dual-view + cross-highlight checks
node scripts/verify-simulation.mjs  # slider -> recolor -> reroute checks
node scripts/verify-e2e.mjs         # upload -> simulate -> report flow
```

Browser scripts need Playwright's Chromium (`playwright-core` + a local Chromium; set
`executablePath` accordingly).

## Beta limitations / production roadmap

- Comtrade enrichment, risk zones, and freight costs are **seeded mocks** — swap
  `data/*.ts` for live feeds (UN Comtrade API, GDACS storm tracks, port-congestion
  indices) when moving past beta.
- Single shared dataset (last upload wins); no auth/multi-tenancy.
- The in-memory graph is the right scale for hundreds of nodes; a property-graph
  database (Neo4j/Memgraph) becomes worthwhile for million-edge Tier-N networks and
  multi-hop exposure queries.
