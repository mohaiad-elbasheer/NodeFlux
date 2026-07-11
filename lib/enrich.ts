// Enrichment layer: attaches mock UN-Comtrade-derived Tier-2 dependency risks
// to a parsed supplier row based on its country of origin.

import {
  COUNTRY_DEPENDENCY_RULES,
  GENERIC_DEPENDENCY_RULES,
} from "@/data/comtrade-seed";
import type { SupplierRow, Tier2Dependency } from "./types";

const COUNTRY_SYNONYMS: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "united states of america": "united states",
  korea: "south korea",
  "republic of korea": "south korea",
  uk: "united kingdom",
  "great britain": "united kingdom",
  "viet nam": "vietnam",
  czechia: "czech republic",
};

export function canonicalCountry(normalized: string): string {
  return COUNTRY_SYNONYMS[normalized] ?? normalized;
}

export function enrichSupplier(
  base: Omit<SupplierRow, "tier2Dependencies">,
  countryNormalized: string,
): SupplierRow {
  const canonical = canonicalCountry(countryNormalized);
  const rules = COUNTRY_DEPENDENCY_RULES[canonical] ?? GENERIC_DEPENDENCY_RULES;

  const tier2Dependencies: Tier2Dependency[] = rules.map((r) => ({
    description: r.description,
    originNodeId: r.originId,
    sharePct: r.sharePct,
    material: r.material,
  }));

  return { ...base, tier2Dependencies };
}
