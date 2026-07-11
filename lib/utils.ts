// Shared client-side helpers for risk styling and formatting.

/** Risk thresholds: green < 0.15, orange 0.15–0.5, red > 0.5. */
export function riskColor(risk: number): string {
  if (risk > 0.5) return "#f43f5e"; // rose-500
  if (risk >= 0.15) return "#f97316"; // orange-500
  return "#10b981"; // emerald-500
}

export function riskLabel(risk: number): "Low" | "Elevated" | "Critical" {
  if (risk > 0.5) return "Critical";
  if (risk >= 0.15) return "Elevated";
  return "Low";
}

export function riskBadgeClasses(risk: number): string {
  if (risk > 0.5) return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  if (risk >= 0.15) return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
}

export function fmtDays(days: number): string {
  return `${Math.round(days * 10) / 10}d`;
}

export function fmtDelta(days: number): string {
  const r = Math.round(days * 10) / 10;
  if (r > 0) return `+${r} days`;
  if (r < 0) return `${r} days`;
  return "no change";
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
