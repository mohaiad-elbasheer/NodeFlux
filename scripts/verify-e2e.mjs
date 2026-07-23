// Phase 4 end-to-end: clear state -> drag-and-drop upload -> dual view ->
// bottleneck simulation -> alternative-path report -> cross-canvas path
// highlighting. Assumes the server on :3100.
import { chromium } from "playwright-core";

const SCRATCH =
  "/tmp/claude-0/-home-user-NodeFlux/d26881af-69d1-5c36-857f-d04f683c2211/scratchpad";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
};

// Start from a clean slate.
await fetch("http://localhost:3100/api/graph", { method: "DELETE" });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});

// 1. Empty state shows the dropzone.
await page.waitForSelector("text=Drop your Tier-1 supplier file here", { timeout: 20000 });
check("empty state shows upload dropzone", true);

// 2. Upload the sample CSV through the real file input.
await page.setInputFiles('input[type="file"]', "public/sample-suppliers.csv");
await page.waitForSelector("text=Geospatial Risk Map", { timeout: 30000 });
check("CSV upload transitions to the dual-view workspace", true);

// 3. Report renders with three ranked paths.
const pathCards = await page.locator("text=RECOMMENDED").count();
check("report shows a recommended path", pathCards >= 1);
const pathCount = await page.locator("li >> text=/^Path \\d/").count();
check("report lists 3 alternative paths", pathCount === 3, `${pathCount}`);

// 4. Clicking a report row highlights the path on BOTH canvases.
await page.locator("li >> text=/^Path 2/").first().click();
await page.waitForTimeout(400);
const highlightedGraphEdges = await page.evaluate(
  () =>
    Array.from(document.querySelectorAll(".react-flow__edge-path")).filter(
      (p) => getComputedStyle(p).stroke === "rgb(226, 232, 240)",
    ).length,
);
check("graph highlights the selected path", highlightedGraphEdges >= 2, `${highlightedGraphEdges} edges`);
const mapPolyline = await page.evaluate(
  () =>
    Array.from(document.querySelectorAll("path.leaflet-interactive")).filter(
      (p) => p.getAttribute("stroke") === "#e2e8f0",
    ).length,
);
check("map draws the selected path polyline", mapPolyline >= 1, `${mapPolyline}`);

// 5. Simulate a Suez bottleneck and confirm the report reacts with deltas.
await page.locator("button", { hasText: "Suez Canal" }).first().click();
await page.locator("#severity-slider").fill("80");
await page.waitForTimeout(600);
const report = await page.locator("text=Top 3 Recommended Pathways").locator("..").textContent();
check(
  "report narrates bottleneck avoidance or exposure with lead-time deltas",
  /(Avoids the Suez|exposed to)/.test(report) && /days/.test(report),
  report.replace(/\s+/g, " ").slice(0, 140),
);

await page.screenshot({ path: `${SCRATCH}/phase4-e2e.png` });

// 6. Malformed CSV degrades gracefully with warnings, not a crash.
await fetch("http://localhost:3100/api/graph", { method: "DELETE" });
await page.reload({ waitUntil: "networkidle" }).catch(() => {});
await page.waitForSelector("text=Drop your Tier-1 supplier file here", { timeout: 20000 });
await page.setInputFiles('input[type="file"]', {
  name: "messy.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    "Supplier,Country,Lead Time,Bogus\nAcme GmbH,Germany,abc,zzz\n,Taiwan,12,\nGhost Co,Wakanda,5,x\n",
  ),
});
await page.waitForSelector("text=Geospatial Risk Map", { timeout: 30000 });
const warnBanner = await page.locator("text=/ingestion warning/").count();
check("messy CSV still renders with a warnings banner", warnBanner === 1);

check("no page JS errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();

// Leave the server on the sample dataset, not the messy test file.
{
  const { readFile } = await import("fs/promises");
  const csv = await readFile("public/sample-suppliers.csv");
  const form = new FormData();
  form.append("file", new File([csv], "sample-suppliers.csv", { type: "text/csv" }));
  await fetch("http://localhost:3100/api/ingest", { method: "POST", body: form });
}
console.log(results.join("\n"));
