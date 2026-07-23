// Tolerant CSV/XLSX row parsing. Header names are matched case/space/
// punctuation-insensitively against known aliases; every field has a default
// so a malformed row degrades to a warning, never a crash.

import { geocode, normalizePlace } from "./geocode";
import { enrichSupplier } from "./enrich";
import type { SupplierRow } from "./types";

export interface ParseOutcome {
  suppliers: SupplierRow[];
  warnings: string[];
}

const HEADER_ALIASES: Record<string, keyof RawFields> = {
  suppliername: "supplierName",
  supplier: "supplierName",
  name: "supplierName",
  vendorname: "supplierName",
  countryoforigin: "country",
  country: "country",
  origincountry: "country",
  city: "city",
  town: "city",
  location: "city",
  productdescription: "product",
  product: "product",
  description: "product",
  hscodechapter85: "hsCode",
  hscode: "hsCode",
  hs: "hsCode",
  estimatedleadtimedays: "leadTime",
  leadtimedays: "leadTime",
  leadtime: "leadTime",
  estleadtime: "leadTime",
};

interface RawFields {
  supplierName?: string;
  country?: string;
  city?: string;
  product?: string;
  hsCode?: string;
  leadTime?: string;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const DEFAULT_LEAD_TIME_DAYS = 14;

/**
 * Locale-aware numeric parsing. Handles "12,5" (EU decimal comma), "1.234"
 * (EU thousands), "1,234.5" (US thousands + decimal), "1 234,5" (space
 * grouping). Rule: when both separators appear, the rightmost one is the
 * decimal mark; a lone separator followed by exactly 3 digits is treated as
 * a thousands separator, otherwise as a decimal mark.
 */
export function parseLocaleNumber(input: string): number {
  let s = input.trim().replace(/[\s ']/g, "");
  s = s.replace(/[^\d.,\-]/g, "");
  if (!/\d/.test(s)) return NaN;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot !== -1 && lastComma !== -1) {
    const dec = Math.max(lastDot, lastComma) === lastDot ? "." : ",";
    const group = dec === "." ? "," : ".";
    s = s.split(group).join("");
    if (dec === ",") s = s.replace(",", ".");
  } else if (lastComma !== -1) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length === 3) {
      s = parts.join(""); // "1,234" -> thousands
    } else if (parts.length > 2) {
      s = parts.join(""); // "1,234,567"
    } else {
      s = parts.join("."); // "12,5" -> decimal
    }
  } else if (lastDot !== -1) {
    const parts = s.split(".");
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      s = parts.join(""); // "1.234" -> thousands
    } else if (parts.length > 2) {
      s = parts.join(""); // "1.234.567"
    }
    // otherwise keep the dot as a decimal mark ("12.5", "1234.56")
  }

  return Number(s);
}

/**
 * Convert already-tabularized records (from papaparse or SheetJS) into
 * validated, geocoded, enriched SupplierRows.
 */
export function rowsToSuppliers(records: Record<string, unknown>[]): ParseOutcome {
  const warnings: string[] = [];
  const suppliers: SupplierRow[] = [];

  if (records.length === 0) {
    warnings.push("File contained no data rows.");
    return { suppliers, warnings };
  }

  // Build a header map from the first record's keys.
  const headerMap = new Map<string, keyof RawFields>();
  const unknownHeaders: string[] = [];
  for (const key of Object.keys(records[0])) {
    const alias = HEADER_ALIASES[normalizeHeader(key)];
    if (alias) headerMap.set(key, alias);
    else if (key.trim()) unknownHeaders.push(key);
  }
  if (unknownHeaders.length > 0) {
    warnings.push(`Ignored unrecognized column(s): ${unknownHeaders.join(", ")}`);
  }
  if (!Array.from(headerMap.values()).includes("supplierName")) {
    warnings.push("No Supplier_Name column detected — generated placeholder names.");
  }
  if (!Array.from(headerMap.values()).includes("country")) {
    warnings.push("No Country_of_Origin column detected — geocoding will fail for all rows.");
  }

  records.forEach((rec, i) => {
    const raw: RawFields = {};
    for (const [key, field] of headerMap) {
      const v = rec[key];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        raw[field] = String(v).trim();
      }
    }

    // A row that is entirely empty is skipped silently.
    if (Object.values(raw).every((v) => !v)) return;

    const rowWarnings: string[] = [];
    const rowNo = i + 2; // 1-based + header row, matches what the analyst sees

    const supplierName = raw.supplierName ?? `Supplier ${suppliers.length + 1}`;
    if (!raw.supplierName) rowWarnings.push("Missing supplier name — placeholder assigned.");

    const country = raw.country ?? "";
    const city = raw.city ?? "";
    if (!country) rowWarnings.push("Missing country of origin.");

    let leadTime = DEFAULT_LEAD_TIME_DAYS;
    if (raw.leadTime !== undefined) {
      const parsed = parseLocaleNumber(String(raw.leadTime));
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 365) {
        leadTime = Math.round(parsed * 10) / 10;
      } else if (Number.isFinite(parsed) && parsed > 365) {
        rowWarnings.push(
          `Lead time "${raw.leadTime}" parsed as ${parsed} days (out of range) — default ${DEFAULT_LEAD_TIME_DAYS}d applied.`,
        );
      } else {
        rowWarnings.push(`Invalid lead time "${raw.leadTime}" — default ${DEFAULT_LEAD_TIME_DAYS}d applied.`);
      }
    } else {
      rowWarnings.push(`Missing lead time — default ${DEFAULT_LEAD_TIME_DAYS}d applied.`);
    }

    const geo = geocode(city, country);
    if (!geo) {
      warnings.push(
        `Row ${rowNo} (${supplierName}): could not geocode "${city || "?"}, ${country || "?"}" — row skipped on map, kept in graph at 0,0.`,
      );
    } else if (geo.approximate) {
      rowWarnings.push(`City "${city || "n/a"}" not in gazetteer — using ${country} country centroid.`);
    }

    const base: Omit<SupplierRow, "tier2Dependencies"> = {
      id: `supplier-${suppliers.length + 1}`,
      supplierName,
      countryOfOrigin: country,
      city,
      productDescription: raw.product ?? "Unspecified electronics (Ch. 85)",
      hsCodeChapter85: raw.hsCode ?? "85",
      estimatedLeadTimeDays: leadTime,
      lat: geo?.lat ?? 0,
      lng: geo?.lng ?? 0,
      geocodeApproximate: geo?.approximate ?? true,
      warnings: rowWarnings,
    };

    suppliers.push(enrichSupplier(base, normalizePlace(country)));
  });

  if (suppliers.length === 0) {
    warnings.push("No valid supplier rows could be extracted from the file.");
  }

  return { suppliers, warnings };
}
