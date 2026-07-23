// Ingestion parsing tests: locale-aware numerics (QC-3) and row defaults.
// Run with: npx tsx scripts/test-csv.ts

import { parseLocaleNumber, rowsToSuppliers } from "@/lib/csv";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

// Locale-aware numeric parsing across EU/US conventions.
const CASES: [string, number][] = [
  ["12,5", 12.5], // EU decimal comma (the confirmed corruption)
  ["1.234", 1234], // EU thousands dot (the confirmed corruption)
  ["1,234", 1234], // US thousands comma
  ["1,234.5", 1234.5], // US full
  ["1.234,5", 1234.5], // EU full
  ["12.5", 12.5], // US decimal
  ["1 234,5", 1234.5], // space grouping
  ["1,234,567", 1234567],
  ["1.234.567", 1234567],
  ["28", 28],
  ["28 days", 28],
  ["0,75", 0.75],
  ["1234.56", 1234.56],
];
for (const [input, expected] of CASES) {
  const got = parseLocaleNumber(input);
  check(
    `parseLocaleNumber("${input}") = ${expected}`,
    Math.abs(got - expected) < 1e-9,
    `got ${got}`,
  );
}
check("non-numeric input yields NaN", Number.isNaN(parseLocaleNumber("abc")));

// End-to-end row behavior for the two confirmed corruptions.
const { suppliers } = rowsToSuppliers([
  { Supplier_Name: "EU Decimal", Country_of_Origin: "Italy", City: "Milan", Estimated_Lead_Time_Days: "12,5" },
  { Supplier_Name: "EU Thousands", Country_of_Origin: "Germany", City: "Munich", Estimated_Lead_Time_Days: "1.234" },
]);
check("'12,5' ingests as 12.5 days", suppliers[0].estimatedLeadTimeDays === 12.5, `${suppliers[0].estimatedLeadTimeDays}`);
check(
  "'1.234' -> 1234 is out of range: default applied with an explanatory warning",
  suppliers[1].estimatedLeadTimeDays === 14 &&
    suppliers[1].warnings.some((w) => w.includes("1234")),
  suppliers[1].warnings.join(" | "),
);

console.log(failures === 0 ? "\nAll CSV tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
