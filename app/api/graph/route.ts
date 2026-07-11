// GET /api/graph — returns the current dataset (rehydrated from the JSON
// snapshot if the server restarted). 404 when nothing has been ingested yet.
// DELETE /api/graph — clears the stored dataset.

import { NextResponse } from "next/server";
import { clearDataset, loadDataset } from "@/lib/server/datastore";

export const runtime = "nodejs";

export async function GET() {
  const dataset = loadDataset();
  if (!dataset) {
    return NextResponse.json({ error: "No dataset ingested yet." }, { status: 404 });
  }
  return NextResponse.json(dataset);
}

export async function DELETE() {
  clearDataset();
  return NextResponse.json({ ok: true });
}
