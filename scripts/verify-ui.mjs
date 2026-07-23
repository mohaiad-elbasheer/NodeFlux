// Phase 2 verification: dual-view renders, sample data loads, and clicking a
// graph node cross-highlights the corresponding map pin.
import { chromium } from "playwright-core";

const SCRATCH = "/tmp/claude-0/-home-user-NodeFlux/d26881af-69d1-5c36-857f-d04f683c2211/scratchpad";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
};

// Seed the sample dataset so this script is self-sufficient.
{
  const { readFile } = await import("fs/promises");
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
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});

// Dataset was pre-ingested server-side, so hydrate() should populate the UI.
await page.waitForSelector("text=Geospatial Risk Map", { timeout: 20000 });
check("dual-view canvases render", true);

const mapPins = await page.locator(".leaflet-interactive").count();
check("map has interactive pins/zones", mapPins > 20, `${mapPins} SVG elements`);

const flowNodes = await page.locator(".react-flow__node").count();
check("graph renders DAG nodes", flowNodes >= 39, `${flowNodes} nodes`);

const flowEdges = await page.locator(".react-flow__edge").count();
check("graph renders edges", flowEdges >= 100, `${flowEdges} edges`);

// Cross-highlight: click a supplier node in the graph, expect amber ring on
// the node and the map pin recolored (stroke #fbbf24).
const supplierNode = page.locator(".react-flow__node", { hasText: "Tier-1 Supplier" }).first();
await supplierNode.click();
await page.waitForTimeout(1200); // flyTo animation

const ringed = await page.locator(".react-flow__node .ring-2").count();
check("graph node shows selection ring", ringed === 1, `${ringed} ringed`);

const amberPins = await page.evaluate(() =>
  Array.from(document.querySelectorAll("path.leaflet-interactive"))
    .filter((p) => p.getAttribute("stroke") === "#fbbf24").length,
);
check("map pin highlighted for graph selection", amberPins === 1, `${amberPins} amber pins`);

const detail = await page.locator("text=Tier-2 dependency risks").count();
check("supplier inspector shows Tier-2 enrichment", detail === 1);

await page.screenshot({ path: `${SCRATCH}/phase2-dualview.png` });

// Map-side selection: click a different map pin, expect graph ring to move.
await page.evaluate(() => {
  const pins = Array.from(document.querySelectorAll("path.leaflet-interactive"))
    .filter((p) => p.getAttribute("stroke") === "#f59e0b"); // an origin node
  pins[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(400);
const ringedLabel = await page
  .locator(".react-flow__node:has(.ring-2)")
  .first()
  .textContent()
  .catch(() => null);
check("map pin click selects graph node", !!ringedLabel && ringedLabel.includes("Raw Material"), ringedLabel?.slice(0, 60) ?? "none");

check("no page JS errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(results.join("\n"));
