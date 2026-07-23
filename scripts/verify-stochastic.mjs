// Sprint 01 verification: stochastic engine mode in the browser — worker
// sampling, distributional path cards, policy-dependent rerouting, SLA
// reactivity, seed reproducibility surfaced in the UI.
import { chromium } from "playwright-core";
import { readFile } from "fs/promises";

const SCRATCH =
  "/tmp/claude-0/-home-user-NodeFlux/d26881af-69d1-5c36-857f-d04f683c2211/scratchpad";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
};

// Seed the sample dataset so this script is self-sufficient.
{
  const csv = await readFile("public/sample-suppliers.csv");
  const form = new FormData();
  form.append("file", new File([csv], "sample-suppliers.csv", { type: "text/csv" }));
  const res = await fetch("http://localhost:3100/api/ingest", { method: "POST", body: form });
  if (!res.ok) throw new Error(`sample ingest failed: ${res.status}`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForSelector("text=Bottleneck Simulation", { timeout: 20000 });

// 1. Toggle to stochastic mode; worker produces a refined result.
await page.locator('[data-testid="engine-stochastic"]').click();
await page.waitForSelector('[data-testid="stochastic-report"]', { timeout: 30000 });
await page.waitForFunction(
  () => document.querySelector('[data-testid="mc-footer"]')?.textContent?.includes("refined"),
  { timeout: 30000 },
);
check("stochastic mode produces a refined Monte Carlo result", true);

const footer = await page.locator('[data-testid="mc-footer"]').textContent();
check("seed and sample size surfaced in the UI", /seed 42/.test(footer) && /N=2000/.test(footer), footer.trim());

const histograms = await page.locator('[data-testid="path-histogram"]').count();
check("path cards render distribution histograms", histograms >= 2, `${histograms}`);

const quantiles = await page.locator('[data-testid="stochastic-report"]').textContent();
check(
  "cards show P50/P95/CVaR and on-time gauge",
  /P50/.test(quantiles) && /P95/.test(quantiles) && /CVaR/.test(quantiles) && /On-time/.test(quantiles),
);

// 2. Focus a German supplier and its Taiwan wafer dependency, then check
//    policy-dependent rerouting under a moderate Suez spike.
await page.locator(".react-flow__node", { hasText: "Bavaria Semiconductor" }).first().click();
await page.waitForTimeout(500);
const originChip = page.locator('[data-testid="stochastic-report"] button', {
  hasText: "Rare Earth",
});
if ((await originChip.count()) > 0) await originChip.first().click();
await page.locator("button", { hasText: "Suez Canal" }).first().click();

const pathOneText = async () => {
  const card = page.locator('[data-testid="stochastic-report"] li').first();
  return (await card.textContent()) ?? "";
};

let diverged = "";
for (const sev of [40, 50, 30, 60]) {
  await page.locator("#severity-slider").fill(String(sev));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="mc-footer"]')?.textContent?.includes("refined"),
    { timeout: 30000 },
  );
  await page.locator('[data-testid="policy-p95"]').click();
  await page.waitForTimeout(800);
  const p95Route = (await pathOneText()).split("mean")[0];
  await page.locator('[data-testid="policy-expected"]').click();
  await page.waitForTimeout(800);
  const expRoute = (await pathOneText()).split("mean")[0];
  if (p95Route !== expRoute) {
    diverged = `severity ${sev}%`;
    break;
  }
}
check("P95 vs Expected policy recommend different Path 1 under Suez spike", diverged !== "", diverged || "no divergence");

await page.screenshot({ path: `${SCRATCH}/sprint1-stochastic.png` });

// 3. SLA reactivity: shrinking the SLA must lower the on-time percentage.
//    Straddle the recommended path's observed P50 so the test is robust to
//    whichever route/supplier is in focus (a fast air route is still 100%
//    on-time at 10 days, which would make fixed SLA values meaningless).
await page.locator('[data-testid="policy-p95"]').click();
await page.waitForTimeout(1200);
const reportText = await page.locator('[data-testid="stochastic-report"]').textContent();
const p50Match = reportText.match(/P50(\d+\.?\d*)d/);
const p50 = p50Match ? Number(p50Match[1]) : 20;
const looseSla = Math.ceil(p50) + 25;
const tightSla = Math.max(1, Math.floor(p50 / 2));

const onTimeAt = async (sla) => {
  await page.locator('input[type="number"]').fill(String(sla));
  await page.waitForFunction(
    (s) =>
      document
        .querySelector('[data-testid="stochastic-report"]')
        ?.textContent?.includes(`P(≤ ${s}d)`),
    sla,
    { timeout: 10000 },
  );
  await page.waitForTimeout(2500);
  const txt = await page.locator('[data-testid="stochastic-report"]').textContent();
  const m = txt.match(/P\(≤ \d+d\)(\d+)%/);
  return m ? Number(m[1]) : NaN;
};
const wide = await onTimeAt(looseSla);
const tight = await onTimeAt(tightSla);
check(
  "tightening the SLA lowers on-time probability",
  wide > tight,
  `P50≈${p50}d → ${wide}% @${looseSla}d vs ${tight}% @${tightSla}d`,
);

// 4. Back to deterministic: legacy report intact.
await page.locator('[data-testid="engine-deterministic"]').click();
await page.waitForSelector("text=Top 3 Recommended Pathways", { timeout: 10000 });
check("deterministic mode restores the legacy report", true);

check("no page JS errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(results.join("\n"));
