// POST /api/ingest — accepts a CSV or XLSX file (multipart form field "file")
// or a raw JSON body { rows: [...] }, parses/validates/enriches it, builds
// the supply-chain DAG, persists the dataset, and returns it.

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { rowsToSuppliers } from "@/lib/csv";
import { buildGraph } from "@/lib/graph/build";
import { saveDataset } from "@/lib/server/datastore";
import { RISK_ZONES } from "@/data/risk-zones";
import type { Dataset } from "@/lib/types";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function parseCsv(text: string): Record<string, unknown>[] {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return result.data;
}

function parseXlsx(buf: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

export async function POST(req: NextRequest) {
  try {
    let records: Record<string, unknown>[] = [];
    let sourceFileName = "upload";
    const fileWarnings: string[] = [];

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "No file provided. Attach a CSV or XLSX as form field 'file'." },
          { status: 400 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "File exceeds the 10 MB beta limit." },
          { status: 413 },
        );
      }
      sourceFileName = file.name || "upload";
      const lower = sourceFileName.toLowerCase();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        records = parseXlsx(await file.arrayBuffer());
      } else {
        records = parseCsv(await file.text());
      }
    } else if (contentType.includes("application/json")) {
      const body = (await req.json()) as { rows?: Record<string, unknown>[]; fileName?: string };
      records = Array.isArray(body.rows) ? body.rows : [];
      sourceFileName = body.fileName ?? "inline-json";
    } else {
      // Treat anything else (e.g. text/csv) as raw CSV text.
      records = parseCsv(await req.text());
      sourceFileName = "raw-csv";
    }

    const { suppliers, warnings } = rowsToSuppliers(records);

    if (suppliers.length === 0) {
      return NextResponse.json(
        {
          error: "No valid supplier rows found in the file.",
          warnings: [...fileWarnings, ...warnings],
        },
        { status: 422 },
      );
    }

    const dataset: Dataset = {
      uploadedAt: new Date().toISOString(),
      sourceFileName,
      suppliers,
      graph: buildGraph(suppliers),
      riskZones: RISK_ZONES,
      warnings: [...fileWarnings, ...warnings],
    };

    saveDataset(dataset);
    return NextResponse.json(dataset);
  } catch (err) {
    console.error("nodeflux ingest error:", err);
    return NextResponse.json(
      { error: "Failed to parse the uploaded file. Check the format and try again." },
      { status: 500 },
    );
  }
}
