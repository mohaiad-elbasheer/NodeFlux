// Phase 3 verification: dragging the bottleneck severity slider recolors
// graph edges instantly and forces an automated pathway rerouting in the
// Top-3 report. Assumes the dev/prod server on :3100; seeds sample data itself.
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
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForSelector("text=Bottleneck Simulation", { timeout: 20000 });

// Focus a German supplier so the report tracks it.
await page.locator(".react-flow__node", { hasText: "Bavaria Semiconductor" }).first().click();
await page.waitForTimeout(600);

const reportBefore = await page.locator("text=Top 3 Recommended Pathways").locator("..").textContent();
check(
  "baseline Path 1 rides the Eurasia rail corridor",
  reportBefore.includes("Rail Corridor"),
);

const edgeStrokes = () =>
  page.evaluate(() => {
    const counts = { green: 0, orange: 0, red: 0 };
    for (const p of document.querySelectorAll(".react-flow__edge-path")) {
      const s = getComputedStyle(p).stroke;
      if (s === "rgb(16, 185, 129)") counts.green++;
      else if (s === "rgb(249, 115, 22)") counts.orange++;
      else if (s === "rgb(244, 63, 94)") counts.red++;
    }
    return counts;
  });

const before = await edgeStrokes();
check("baseline has green edges and no red edges", before.green > 30 && before.red === 0, JSON.stringify(before));

// Drive the slider: East Asia Hub to 80%.
await page.locator("button", { hasText: "East Asia Hub" }).first().click();
await page.locator("#severity-slider").fill("80");
await page.waitForTimeout(120); // instant restyle, before debounce fires

const during = await edgeStrokes();
check(
  "edges spike red instantly on slider drag",
  during.red > 10 && during.green < before.green,
  JSON.stringify(during),
);

await page.waitForTimeout(500); // debounced recompute (150ms) settles

const reportAfter = await page.locator("text=Top 3 Recommended Pathways").locator("..").textContent();
const path1After = reportAfter.split("Path 2")[0];
check(
  "automated rerouting: Path 1 leaves the rail corridor at 80% severity",
  !path1After.includes("Rail Corridor"),
  path1After.replace(/\s+/g, " ").slice(0, 160),
);
check(
  "report explains bottleneck avoidance / lead-time delta",
  reportAfter.includes("bottleneck") || reportAfter.includes("exposed to"),
);

const sliderValue = await page.locator("#severity-slider").inputValue();
check("slider reads back 80%", sliderValue === "80");

await page.screenshot({ path: `${SCRATCH}/phase3-simulation.png` });

// Reset restores baseline coloring.
await page.locator("button", { hasText: "Reset all" }).click();
await page.waitForTimeout(400);
const reset = await edgeStrokes();
check("reset restores baseline edge colors", reset.red === 0 && reset.green >= before.green - 1, JSON.stringify(reset));

check("no page JS errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(results.join("\n"));
