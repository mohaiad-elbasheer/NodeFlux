// Mock "Climate & Infrastructure Risk Heatmap" layer: active typhoons, port
// congestion, and geopolitical stress zones. In production this would be fed
// by live feeds (JTWC/GDACS storm tracks, port-congestion indices).

import { REGIONS } from "./comtrade-seed";
import type { RiskZone } from "@/lib/types";

export const RISK_ZONES: RiskZone[] = [
  {
    id: "rz-typhoon-luzon",
    name: "Typhoon Halong — Luzon Strait",
    kind: "typhoon",
    lat: 20.5,
    lng: 122.0,
    radiusKm: 700,
    severity: 0.55,
    region: REGIONS.SOUTH_CHINA_SEA,
  },
  {
    id: "rz-typhoon-okinawa",
    name: "Tropical Storm — East China Sea",
    kind: "typhoon",
    lat: 27.5,
    lng: 127.0,
    radiusKm: 550,
    severity: 0.4,
    region: REGIONS.EAST_ASIA,
  },
  {
    id: "rz-congestion-lalb",
    name: "Port Congestion — LA/Long Beach Anchorage",
    kind: "port-congestion",
    lat: 33.7,
    lng: -118.2,
    radiusKm: 220,
    severity: 0.45,
    region: REGIONS.WEST_COAST,
  },
  {
    id: "rz-suez-transit",
    name: "Red Sea / Suez Transit Disruption",
    kind: "geopolitical",
    lat: 27.0,
    lng: 34.5,
    radiusKm: 900,
    severity: 0.5,
    region: REGIONS.SUEZ,
  },
  {
    id: "rz-panama-drought",
    name: "Panama Canal Draft Restrictions (Drought)",
    kind: "drought",
    lat: 9.1,
    lng: -79.7,
    radiusKm: 250,
    severity: 0.35,
    region: REGIONS.PANAMA,
  },
  {
    id: "rz-congestion-rotterdam",
    name: "Labor Action — Rotterdam Terminals",
    kind: "port-congestion",
    lat: 51.95,
    lng: 4.14,
    radiusKm: 150,
    severity: 0.2,
    region: REGIONS.NORTH_EUROPE,
  },
];
