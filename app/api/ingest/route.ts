// POST /api/ingest — accepts a CSV or XLSX file (multipart form field "file")
// or a raw JSON body { rows: [...] }, parses/validates/enriches it, builds
// the supply-chain DAG, persists the dataset, and returns it.

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { rowsToSuppliers } from "@/lib/csv";
import { buildGraph } from "@/lib/graph/build";
import { SCHEMA_VERSION, saveDataset } from "@/lib/server/datastore";
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

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return v.result === undefined ? "" : String(v.result);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

async function parseXlsx(buf: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellText(cell.value).trim();
  });

  const records: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rec: Record<string, unknown> = {};
    for (let col = 1; col < headers.length; col++) {
      if (!headers[col]) continue;
      rec[headers[col]] = cellText(row.getCell(col).value);
    }
    records.push(rec);
  });
  return records;
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
      if (lower.endsWith(".xls")) {
        return NextResponse.json(
          { error: "Legacy .xls is not supported — save as .xlsx or .csv and retry." },
          { status: 415 },
        );
      }
      if (lower.endsWith(".xlsx")) {
        records = await parseXlsx(await file.arrayBuffer());
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
      schemaVersion: SCHEMA_VERSION,
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
