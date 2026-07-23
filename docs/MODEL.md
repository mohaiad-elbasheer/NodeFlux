# NodeFlux Stochastic Model — Specification & Parameters

This document is the authority on every distribution, parameter, and
assumption in the stochastic engine. All values are **calibration stubs**
chosen to be plausible and to exercise the mechanics; each has a calibration
TODO for when live data lands. The design goal is that moving to production
is a *data* change (edit the tables below and their source files), not a
*code* change.

Sprint reference: `docs/SPRINT-01-STOCHASTICITY.md`.

---

## 1. Deterministic layer (unchanged, still the default)

Per the original spec, each edge has a scalar weight:

```
weight = baseLeadTime · (1 + macroRiskModifier) + staticFreightCost
macroRiskModifier = baselineRisk + Σ severity[r]   for r in edge.regions   (capped at MAX_RISK_MODIFIER = 2.5)
```

- `baseLeadTime`, `staticFreightCost` — derived deterministically per leg from
  great-circle distance and `MODE_PARAMS` (`data/comtrade-seed.ts`), so a leg
  shared by multiple lanes/suppliers always gets identical values.
- `baselineRisk` — max of endpoint node baseline risk, itself the max of the
  seed floor and any overlapping risk-zone contribution (`lib/graph/build.ts`).

Source: `lib/graph/engine.ts` (`edgeWeight`, `effectiveEdgeRisk`).

---

## 2. Stochastic layer

Engine mode `stochastic` replaces the scalar lead time with a **distribution
per leg** and evaluates whole paths by **Monte Carlo**. Freight stays
deterministic (it is a cost, not a time, and does not vary per shipment in
this model).

### 2.1 Idiosyncratic leg lead time — PERT

Each edge `e` draws its "normal-conditions" lead time from a PERT (scaled
Beta) three-point distribution:

| Parameter | Value | Meaning | Calibration TODO |
| --- | --- | --- | --- |
| `min` | `mode · 0.85` | best case | Fit from carrier on-time distributions per mode/lane |
| `mode` | `baseLeadTime` | modal transit (deterministic value) | Keep as the point estimate |
| `max` | `mode · (1.15 + 2·baselineRisk)` | worst case, widened by leg risk | Fit P95/P50 ratios from historical transit times |

PERT analytic mean is `(min + 4·mode + max) / 6`, used by the test suite to
verify sampler convergence. Source: `lib/stochastic/model.ts`
(`pertParamsFor`), sampler in `lib/stochastic/distributions.ts`.

### 2.2 Regional disruption — event × magnitude (common shock)

For every region `r` with slider severity `s = severity[r] > 0`, once **per
scenario** (not per leg):

```
event occurs  with probability  min(0.95, s)                         [Bernoulli]
if event:  magnitude M_r ~ Lognormal( μ = ln(0.4 + 2.2·s), σ = 0.55 ) [multiplicative delay]
```

Every leg tagged with region `r` (`edge.regions`) is then multiplied by
`(1 + M_r)` in that scenario. Because `M_r` is drawn once and shared, all
same-region legs move together — this is the one-factor common-shock model
that produces realistic **portfolio correlation** (verified: same-region
leg correlation ≈ 0.99, cross-region ≈ 0 under disruption).

| Parameter | Value | Meaning | Calibration TODO |
| --- | --- | --- | --- |
| event prob | `min(0.95, s)` | slider severity = disruption likelihood | Map severity to historical port/route closure frequency |
| `μ` | `ln(0.4 + 2.2·s)` | median multiplicative delay grows with severity | Fit from delay distributions during real disruptions (Suez 2021, LA/LB congestion) |
| `σ` | `0.55` | log-space spread of delay magnitude | Fit; consider per-region σ |
| event-prob cap | `0.95` | never a certainty | Keep < 1 for numerical stability |

Source: `MODEL_PARAMS` and the scenario loop in `evaluatePortfolioMC`
(`lib/stochastic/model.ts`).

> **Correlation structure.** This is a **single-factor** model: one shock per
> region. It does *not* yet model cross-region contagion (a Suez event raising
> Panama demand) or a global common factor. That is a deliberate scope
> boundary — see §5.

### 2.3 Path aggregation & statistics

A path's lead time in a scenario is the sum of its leg samples. Across
`N` scenarios we report, per path (`PathStats`):

`mean, stdev, P50, P90, P95, CVaR₉₅` (mean of the worst 5%), and
`onTimeProb = P(total ≤ SLA)`, plus a 24-bin histogram for the UI.

### 2.4 Variance reduction — Common Random Numbers (CRN)

All candidate paths across all suppliers are evaluated in **one** MC pass
that shares:
- the same regional shock draws, and
- the same per-edge idiosyncratic draws (an edge used by two paths contributes
  the identical sample to both in a given scenario).

This makes path *differences* low-variance: the delta between two paths that
share legs is exact on the shared portion. Verified by the test
`mean(A+B) − mean(A) = mean(B)` holding to rounding. Draw counts per scenario
are held fixed regardless of event outcomes so streams stay aligned across
different severity settings.

### 2.5 Seeding & reproducibility

`mulberry32` PRNG with derived per-stream seeds (`deriveSeed`). Two streams:
`"regions"` and `"edges"`, so region and leg draws are independent. Every run
is byte-exact reproducible from `(seed, N, severity, policy, SLA)`. Default
seed = 42, surfaced in the UI footer.

Source: `lib/stochastic/rng.ts`.

---

## 3. Routing under uncertainty

1. **Candidates:** Yen's K-shortest (K = 6) on *expected* edge weights, per
   `(supplier, Tier-2 origin)` pair — every Comtrade dependency is routed,
   not just the top-share one.
2. **Evaluate:** one CRN Monte Carlo pass over the union of all candidates.
3. **Rank** by the analyst's risk policy; deterministic total weight breaks
   ties.

| Policy | Ranks by | Use case |
| --- | --- | --- |
| `expected` | mean + freight | Cost/time-neutral baseline |
| `p95` (default) | P95 + freight | Risk-averse: protect against tail delay |
| `cvar95` | CVaR₉₅ + freight | Worst-case-focused (expected shortfall) |
| `onTime` | −P(≤ SLA), freight tiebreak | Maximize SLA compliance |

Freight is added to time-based scores in the same day+unit convention as the
deterministic weight, so a marginally faster but far more expensive air lane
does not automatically win. Source: `lib/graph/stochastic-routing.ts`.

---

## 4. Performance envelope

- Sampling runs in a **Web Worker** (`lib/workers/mc.worker.ts`); the UI
  thread never blocks. Falls back to synchronous evaluation if Workers are
  unavailable.
- **Progressive refinement:** N = 200 during slider drags (throttled ~120 ms),
  N = 2000 on settle (debounced 300 ms). Stale worker responses are dropped by
  request id.

Parameters: `MC_N_LIVE`, `MC_N_REFINED`, `MC_SEED` in `lib/store.ts`.

---

## 5. Known limitations & scope boundaries

- **Single-factor correlation** only (§2.2). No cross-region contagion, no
  global common factor, no time-dynamics (a disruption is a per-scenario
  multiplier, not a queue that builds and drains).
- **No recourse.** The model computes fixed-path distributions; it does not
  solve the Stochastic Shortest Path *with recourse* (adaptive mid-route
  re-decisions / MDP). Explicit backlog item.
- **Freight is deterministic** and unitless (abstract cost units).
- **All parameters are stubs.** None are fitted to data yet; every table above
  has a calibration TODO. Treat absolute day counts as illustrative and
  relative comparisons (path A vs B, severity 0 vs 80%) as the meaningful
  output at this stage.

---

## 6. Test coverage (statistical guarantees)

`scripts/test-stochastic.ts` asserts:
- PERT & lognormal sample means converge to analytic means (< 1–2%).
- Byte-exact seed reproducibility; different seeds differ.
- Exact CRN delta cancellation on shared legs.
- Correlation recovery via variance decomposition (same-region ≈ 0.99,
  cross-region ≈ 0).
- Monotonicity: P95 and SLA-miss probability rise with severity; zero severity
  induces no phantom disruptions.
- Routing: all Tier-2 origins routed; P95 policy diverges from Expected under a
  Suez spike; edge tail ratios exposed.
