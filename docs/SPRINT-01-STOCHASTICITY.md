# Sprint 01 — From Deterministic Beta to a Realistic Stochastic Engine

**Status: DELIVERED** (approved as-is with proposed defaults: SLA 30d, P95
default policy, deterministic default on load, legacy `.xls` dropped).
Sprint length: 10 working days. Numbering is stable so items can be approved,
amended, or struck individually.

## Delivery summary

All six workstreams landed. Full detail in `docs/MODEL.md`.

| Item | Status | Where |
| --- | --- | --- |
| QC-1 stochasticity | ✅ | `lib/stochastic/*`, `lib/graph/stochastic-routing.ts` |
| QC-2 xlsx advisories | ✅ exceljs; next→15.5.21 | `app/api/ingest/route.ts` |
| QC-3 locale numbers | ✅ `parseLocaleNumber` | `lib/csv.ts`, `scripts/test-csv.ts` |
| QC-4 order-dependent edges | ✅ canonical legs | `data/comtrade-seed.ts`, `lib/graph/build.ts` |
| QC-5 endpoint-max risk | ✅ `edge.regions[]` additive | `lib/graph/engine.ts` |
| QC-6 vuln metric | ✅ superseded by P95/CVaR | `lib/stochastic/model.ts` |
| QC-7 single-origin routing | ✅ all Tier-2 origins routed | `lib/graph/stochastic-routing.ts` |
| QC-8 antimeridian arcs | ✅ great-circle split | `components/GeoMap.tsx` |
| QC-9 no CI | ✅ GitHub Actions | `.github/workflows/ci.yml` |
| S-1 MC core | ✅ 15 statistical assertions | `scripts/test-stochastic.ts` |
| S-2 policy routing | ✅ 4 policies | `lib/stochastic/model.ts` |
| S-3 Web Worker | ✅ progressive 200/2000 | `lib/workers/mc.worker.ts` |
| S-4 uncertainty UI | ✅ histograms/gauges/toggle | `components/*` |
| S-5 verify/docs | ✅ 4 browser suites + MODEL.md | `scripts/`, `docs/MODEL.md` |

Remaining audit finding: one moderate build-time-only `postcss` transitive
advisory via Next; no runtime exposure, awaiting upstream. QC-10 (multi-dataset,
DC config) and recourse routing remain on the backlog by design.

---

*(Original plan preserved below for reference.)*

---

## Part A — QC Audit of the Current Beta

### A.1 What was re-verified and passes

| Check | Result |
| --- | --- |
| Engine unit suite (`npm run test:engine`, 12 assertions) | PASS |
| Browser suites: dual-view (9), simulation (8), e2e (9) | PASS (pre-restart run) |
| `npm run lint`, `npm run build` | Clean |
| DAG acyclicity on sample ingest (39 nodes / 122 edges) | PASS |

### A.2 Defects found (ordered by severity)

**QC-1 (HIGH, correctness) — "Stochastic" engine is deterministic.**
`lib/graph/engine.ts` computes a single scalar weight
`lead_time × (1 + risk) + freight`. There are no random variables, no
distributions, no variance, no probabilistic outputs. "Vulnerability" is a
relabeled mean edge risk. This is the core gap Part B addresses.

**QC-2 (HIGH, security) — `xlsx@0.18.5` has unfixable advisories.**
`npm audit`: prototype pollution (GHSA-4r6h-8v6p-xvw6) + ReDoS
(GHSA-5pgg-2g8v-p4x9), no patched npm release. Replace with `exceljs`
(parse-only use) or vendor the official SheetJS CDN build.

**QC-3 (HIGH, data integrity) — European number formats corrupt lead times.**
Confirmed live: `Estimated_Lead_Time_Days = "12,5"` ingests as **125 days**;
`"1.234"` (thousands separator) ingests as **1 day**. The sanitizer
`replace(/[^\d.-]/g, "")` in `lib/csv.ts` is locale-naive. For an EU analyst
user base this silently distorts every downstream weight.

**QC-4 (MEDIUM, model correctness) — Shared-edge parameters are
order-dependent.** `buildGraph` dedupes edges first-wins: a leg shared by two
lanes (e.g. `origin → Port of Shanghai` in both the Europe and North-America
lane sets) keeps whichever lane was processed first, so its lead time/freight
depends on CSV row order. Lanes need canonical per-leg definitions instead of
distance-apportioned lane totals.

**QC-5 (MEDIUM, model realism) — Risk is endpoint-max, not leg-scoped.**
`effectiveEdgeRisk` takes `max(source.region, target.region)` severity. Two
consequences: (a) an edge whose both endpoints sit in two *different* spiked
regions doesn't compound; (b) a leg that physically transits a region between
endpoints (Malacca→Suez crosses the Indian Ocean) is invisible to zone risk.
Edges should carry their own region tags.

**QC-6 (MEDIUM, metric design) — Vulnerability score is length-insensitive.**
Mean edge risk × 10 lets a long path with one catastrophic leg outscore a
short mildly-risky path. Superseded by real risk measures (P95/CVaR) in
Part B.

**QC-7 (LOW, scope realism) — Only the top-share Tier-2 origin is routed** per
supplier; secondary dependencies appear in the graph but not in the report.

**QC-8 (LOW, visual) — Map path polylines cross the antimeridian** as straight
world-spanning segments; should be great-circle arcs split at ±180°.

**QC-9 (LOW, ops) — No CI.** Verification suites exist but only run manually;
no GitHub Actions workflow guards the branch.

**QC-10 (LOW, product) — Single hardcoded DC (Milan), single shared dataset**
(last upload wins). Accepted beta constraints; carried on the backlog, not in
this sprint.

---

## Part B — Sprint Goal & Backlog

> **Sprint goal:** an analyst can toggle the engine from *Deterministic* to
> *Stochastic* and see, for the same portfolio, distributional lead times
> (P50/P90/P95), on-time-delivery probability against an SLA, and Top-3
> pathway recommendations ranked by a selectable risk policy — with the
> slider workflow staying smooth (drag latency < 100 ms) and every number
> reproducible from a fixed seed.

### Workstream S-0: QC remediation (Days 1–2)

- **S-0.1** Locale-aware numeric parsing (fixes QC-3): detect `12,5` vs
  `1,234.5` vs `1.234`; property tests over EU/US formats.
  *Accept:* the two confirmed corruptions parse as 12.5 and 1234 (→ clamped
  warning), with row warnings on ambiguity.
- **S-0.2** Replace `xlsx` with `exceljs` for `.xlsx` parsing (fixes QC-2);
  drop legacy `.xls` (CSV fallback documented). *Accept:* `npm audit` clean.
- **S-0.3** Canonical leg catalogue (fixes QC-4): define per-leg
  `{from, to, mode, days, freight, regions[]}` once in
  `data/comtrade-seed.ts`; lanes become ordered leg references. Edges carry
  `regions: string[]` (fixes QC-5, additive severity capped at
  `MAX_RISK_MODIFIER`). *Accept:* graph identical regardless of row order
  (test), Indian-Ocean leg responds to both Malacca and Suez sliders.
- **S-0.4** GitHub Actions CI (fixes QC-9): lint + build + engine tests +
  headless UI suite on push. *Accept:* red build on a seeded regression.
- **S-0.5** Great-circle arcs with antimeridian split for map paths
  (fixes QC-8, timeboxed to ½ day, else moves to backlog).

### Workstream S-1: Stochastic model core (Days 2–5)

- **S-1.1** Type layer: each edge gets
  `leadTime: { dist: "pert", min, mode, max }` (mode = current value;
  min/max seeded as mode×0.85 / mode×(1+2·baselineRisk), overridable in the
  leg catalogue) — deterministic mode keeps using `mode`, so behavior is
  backward-compatible.
- **S-1.2** Disruption overlay: per region, an event model
  `P(event) = f(severity)`, delay `D ~ Lognormal(μ(severity), σ)` added to
  all legs tagged with that region. Slider now drives a *probability and
  magnitude*, not a scalar multiplier.
- **S-1.3** Correlation: one-factor Gaussian copula — a shared standard-normal
  shock per region ties together all legs in that region per sample, so a
  Suez event delays every Suez leg in the same scenario (this is what makes
  portfolio risk realistic rather than independent noise).
- **S-1.4** Monte Carlo evaluator: seeded RNG (mulberry32/xoshiro),
  N configurable; per-path outputs: mean, P50, P90, P95, CVaR₉₅,
  `P(T ≤ SLA)`. **Common random numbers** across candidate paths so path
  deltas are low-variance and fair.
- **S-1.5** Statistical test suite: sample-mean convergence to analytic PERT
  mean (tolerance bands), CRN variance-reduction demonstrated, seed
  reproducibility byte-exact, correlation matrix recovery within tolerance.
  *Accept:* all statistical tests pass in CI.

### Workstream S-2: Routing under uncertainty (Days 5–6)

- **S-2.1** Candidate generation: Yen's K-shortest (K=6) on *expected*
  weights — unchanged code path, now producing a candidate set.
- **S-2.2** Ranking: evaluate candidates via S-1.4 and rank by the selected
  risk policy — `Expected` | `P95 (risk-averse)` | `CVaR₉₅` | `On-time
  probability`. Also routes *all* Tier-2 origins per supplier, weighted by
  `sharePct` (fixes QC-7). *Accept:* under an 80% Suez spike with P95 policy,
  the recommended path differs from the Expected-policy path in at least one
  sample scenario of the demo portfolio (documented fixture).

### Workstream S-3: Performance envelope (Days 6–7)

- **S-3.1** Move sampling to a Web Worker; transferable typed arrays;
  UI thread never blocks. *Accept:* slider drag at N=200 progressive samples
  keeps input latency < 100 ms on a mid-range laptop profile.
- **S-3.2** Progressive refinement: 200 samples live during drag → 2,000 on
  300 ms settle → results cache keyed by severity-state hash.

### Workstream S-4: Uncertainty UI (Days 7–9)

- **S-4.1** Engine mode toggle (Deterministic | Stochastic) + risk-policy
  selector + SLA input (default 30 days) in the simulation panel.
- **S-4.2** Path cards: mini histogram strip, P50/P95 chips, on-time
  probability gauge, deltas with uncertainty ("+4.2 ± 1.8 days, 90% CI").
- **S-4.3** Sensitivity ("tornado") mini-chart: which region contributes most
  variance to the focused supplier's lead time. *(Stretch — first to drop.)*
- **S-4.4** Graph/map encode P95-based coloring in stochastic mode so visual
  risk = tail risk, not mean risk.

### Workstream S-5: Verification, docs, demo (Days 9–10)

- **S-5.1** Extend Playwright suites: mode toggle, policy switch changes
  ranking on the fixture, seed reproducibility surfaced in UI footer.
- **S-5.2** `docs/MODEL.md`: every distribution, parameter, and assumption
  with its seed value and calibration TODO; README update.
- **S-5.3** Recorded demo script (upload → toggle stochastic → Suez 80% →
  policy comparison) as the sprint review artifact.

### Explicitly out of scope (backlog)

Stochastic shortest path **with recourse** (adaptive mid-route rerouting
policies / MDP formulation); live UN Comtrade & weather feeds; multi-dataset
persistence & auth; graph-database migration; DC configurability (QC-10).

### Risks

1. **Calibration data absent** — parameters are structured guesses. Mitigation:
   isolate all parameters in one reviewed file (S-5.2) so live-data calibration
   is a data change, not a code change.
2. **Performance on large uploads** (100+ suppliers × K candidates × N
   samples). Mitigation: S-3 budget tests; degrade N, never block UI.
3. **Scope creep toward recourse models** — explicitly out of scope.

### Decisions requested from the product owner

- **D-1** Default SLA (proposed: 30 days) and default risk policy
  (proposed: P95).
- **D-2** Sample sizes N=200 live / N=2,000 settled — acceptable?
- **D-3** Keep deterministic mode as the default on load? (proposed: yes,
  stochastic opt-in this sprint.)
- **D-4** Drop legacy `.xls` support in exchange for a clean audit (S-0.2)?
