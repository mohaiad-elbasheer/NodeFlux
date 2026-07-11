// Offline geocoder: city lookup with country-centroid fallback. Deterministic
// jitter keeps multiple suppliers in the same unknown city from stacking on
// one pixel while staying stable across re-uploads.

import { CITY_COORDS, COUNTRY_COORDS } from "@/data/gazetteer";

export interface GeocodeResult {
  lat: number;
  lng: number;
  approximate: boolean;
}

export function normalizePlace(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashJitter(seed: string): { dLat: number; dLng: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000 - 0.5;
  const b = ((Math.imul(h, 2654435761) >>> 0) % 1000) / 1000 - 0.5;
  return { dLat: a * 1.6, dLng: b * 1.6 };
}

export function geocode(city: string, country: string): GeocodeResult | null {
  const cityKey = normalizePlace(city);
  if (cityKey && CITY_COORDS[cityKey]) {
    const p = CITY_COORDS[cityKey];
    return { lat: p.lat, lng: p.lng, approximate: false };
  }

  const countryKey = normalizePlace(country);
  if (countryKey && COUNTRY_COORDS[countryKey]) {
    const p = COUNTRY_COORDS[countryKey];
    const { dLat, dLng } = hashJitter(cityKey || countryKey);
    return { lat: p.lat + dLat, lng: p.lng + dLng, approximate: true };
  }

  return null;
}
