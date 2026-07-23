# NodeFlux — Sprint 01 Demo Walkthrough

A 5-minute scripted walkthrough of the stochastic engine, suitable for a
sprint review. Each step names the exact UI action and what to point out.

## Setup

```bash
npm install
npm run dev            # http://localhost:3000
```

## Script

1. **Ingest.** On the empty state, click **"Load sample electronics
   portfolio"** (15 Tier-1 suppliers, HS Ch. 85). The dual view appears:
   geospatial risk map (left) + dependency DAG (right). Point out that pins,
   ports/chokepoints, and the climate risk-zone overlay all rendered from one
   CSV, auto-geocoded and auto-enriched with Tier-2 dependencies.

2. **Cross-highlight.** Click **Bavaria Semiconductor AG** in the graph → its
   map pin rings amber and the map pans to Dresden; the inspector shows its
   injected Tier-2 risks ("Sourcing 75% Polysilicon from East Asia Hub", etc.).

3. **Deterministic baseline.** In the simulation panel (engine = Deterministic,
   the default), the Top-3 report shows the optimal inbound pathway. Note the
   green edges and the single vulnerability score.

4. **Flip to Stochastic.** Click the **Stochastic** toggle. The report changes:
   each pathway now shows a **distribution histogram**, a **P50/P90/P95 grid**,
   a **CVaR₉₅** badge, and an **on-time probability gauge** against the 30-day
   SLA. The footer confirms `seed 42 · N=2000 · reproducible run`.

5. **Simulate a Suez bottleneck.** Select **Suez Canal**, drag the severity
   slider to **40%**. Watch: edges recolor by *tail* risk instantly, the
   histograms shift right and fatten, on-time probabilities drop, and the
   report auto-focuses the most tail-impacted supplier.

6. **Compare risk policies.** With Suez at 40%, toggle **Expected → P95**. The
   recommended Path 1 *changes* — the expected-value-fastest lane has a fat
   delay tail, so the risk-averse policy recommends a stabler alternative. This
   is the headline capability: the "best" route depends on the analyst's risk
   appetite, and NodeFlux makes that explicit.

7. **On-time SLA.** Lower the **SLA** field from 30 to 15 days → every on-time
   gauge drops. Raise it to 45 → they recover. The SLA is a live constraint,
   not a static label.

8. **Reproducibility.** Nothing here is hand-waved: same seed + same inputs =
   byte-identical numbers, provable via `npm run test:stochastic`.

## What to emphasize for stakeholders

- The engine is **genuinely stochastic** now — distributions, correlated
  regional shocks, and tail-risk metrics — not a relabeled scalar.
- **Same-region legs move together** (one Suez event delays every Suez leg in a
  scenario): portfolio risk is realistic, not independent noise.
- All parameters are **calibration stubs** (see `docs/MODEL.md`); production is
  a data-calibration exercise, not a rewrite.

## Verification artifacts

- `npm test` — 30+ unit/statistical assertions.
- `npm run verify:ui` — 4 headless-browser suites (needs `CHROMIUM_PATH`).
- CI runs all of the above on every push (`.github/workflows/ci.yml`).
