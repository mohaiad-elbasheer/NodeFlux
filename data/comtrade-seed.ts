// Mock seed database derived from UN Comtrade bilateral trade patterns for
// HS Chapter 85 (electrical machinery & electronics). This stands in for a
// live Comtrade API integration in the beta: given a supplier's country, it
// yields the typical upstream Tier-2 raw-material/component dependencies and
// the trade-route (port/chokepoint) topology those flows traverse.

import type { GraphNode, TransportMode } from "@/lib/types";

// ---------------------------------------------------------------------------
// Bottleneck regions — the units the simulation slider operates on.
// ---------------------------------------------------------------------------
export const REGIONS = {
  SUEZ: "Suez Canal",
  MALACCA: "Malacca Strait",
  WEST_COAST: "US West Coast Ports",
  EAST_ASIA: "East Asia Hub",
  NORTH_EUROPE: "North Europe Ports",
  PANAMA: "Panama Canal",
  SOUTH_CHINA_SEA: "South China Sea",
} as const;

export type RegionName = (typeof REGIONS)[keyof typeof REGIONS];

// ---------------------------------------------------------------------------
// Static port / trade-route nodes (always present in the DAG).
// baselineRisk here is a quiet-day floor; risk zones may raise it further.
// ---------------------------------------------------------------------------
export interface PortSeed {
  id: string;
  label: string;
  lat: number;
  lng: number;
  region: RegionName;
  baselineRisk: number;
}

export const PORTS: PortSeed[] = [
  { id: "port-shanghai", label: "Port of Shanghai", lat: 30.626, lng: 122.064, region: REGIONS.EAST_ASIA, baselineRisk: 0.08 },
  { id: "port-shenzhen", label: "Port of Shenzhen (Yantian)", lat: 22.576, lng: 114.27, region: REGIONS.SOUTH_CHINA_SEA, baselineRisk: 0.08 },
  { id: "port-kaohsiung", label: "Port of Kaohsiung", lat: 22.615, lng: 120.282, region: REGIONS.EAST_ASIA, baselineRisk: 0.1 },
  { id: "port-busan", label: "Port of Busan", lat: 35.104, lng: 129.042, region: REGIONS.EAST_ASIA, baselineRisk: 0.06 },
  { id: "port-tokyo", label: "Port of Tokyo/Yokohama", lat: 35.454, lng: 139.68, region: REGIONS.EAST_ASIA, baselineRisk: 0.06 },
  { id: "port-singapore", label: "Port of Singapore", lat: 1.264, lng: 103.84, region: REGIONS.MALACCA, baselineRisk: 0.07 },
  { id: "route-malacca", label: "Malacca Strait Transit", lat: 2.5, lng: 101.0, region: REGIONS.MALACCA, baselineRisk: 0.1 },
  { id: "route-suez", label: "Suez Canal Transit", lat: 30.46, lng: 32.35, region: REGIONS.SUEZ, baselineRisk: 0.12 },
  { id: "port-rotterdam", label: "Port of Rotterdam", lat: 51.949, lng: 4.145, region: REGIONS.NORTH_EUROPE, baselineRisk: 0.05 },
  { id: "port-hamburg", label: "Port of Hamburg", lat: 53.541, lng: 9.937, region: REGIONS.NORTH_EUROPE, baselineRisk: 0.05 },
  { id: "port-la-lb", label: "Ports of LA / Long Beach", lat: 33.74, lng: -118.26, region: REGIONS.WEST_COAST, baselineRisk: 0.09 },
  { id: "port-oakland", label: "Port of Oakland", lat: 37.795, lng: -122.31, region: REGIONS.WEST_COAST, baselineRisk: 0.08 },
  { id: "route-panama", label: "Panama Canal Transit", lat: 9.08, lng: -79.68, region: REGIONS.PANAMA, baselineRisk: 0.1 },
  { id: "rail-eurasia", label: "China–Europe Rail Corridor", lat: 43.9, lng: 76.9, region: REGIONS.EAST_ASIA, baselineRisk: 0.06 },
  { id: "air-hub-global", label: "Global Air Freight Hub (ANC/HKG)", lat: 61.17, lng: -149.99, region: REGIONS.EAST_ASIA, baselineRisk: 0.04 },
];

// ---------------------------------------------------------------------------
// Raw-material origin nodes referenced by the Tier-2 dependency rules.
// ---------------------------------------------------------------------------
export interface OriginSeed {
  id: string;
  label: string;
  lat: number;
  lng: number;
  region: RegionName;
  baselineRisk: number;
}

export const ORIGINS: OriginSeed[] = [
  { id: "origin-polysilicon-ea", label: "Polysilicon — East Asia Hub (Xinjiang/Jiangsu)", lat: 43.8, lng: 87.6, region: REGIONS.EAST_ASIA, baselineRisk: 0.15 },
  { id: "origin-rare-earth-cn", label: "Rare Earth Elements — Inner Mongolia", lat: 40.65, lng: 109.83, region: REGIONS.EAST_ASIA, baselineRisk: 0.18 },
  { id: "origin-wafers-tw", label: "Semiconductor Wafers — Hsinchu Cluster", lat: 24.81, lng: 120.97, region: REGIONS.EAST_ASIA, baselineRisk: 0.14 },
  { id: "origin-memory-kr", label: "Memory & MLCC — Korea Cluster", lat: 37.26, lng: 127.03, region: REGIONS.EAST_ASIA, baselineRisk: 0.08 },
  { id: "origin-photoresist-jp", label: "Photoresist & Wafer Chemicals — Japan", lat: 35.68, lng: 139.65, region: REGIONS.EAST_ASIA, baselineRisk: 0.07 },
  { id: "origin-cobalt-drc", label: "Cobalt — DRC Copperbelt", lat: -10.7, lng: 25.5, region: REGIONS.SUEZ, baselineRisk: 0.22 },
  { id: "origin-lithium-sa", label: "Lithium — South America Triangle", lat: -23.5, lng: -68.0, region: REGIONS.PANAMA, baselineRisk: 0.12 },
  { id: "origin-pcb-cn", label: "PCB & Passive Components — Pearl River Delta", lat: 22.9, lng: 113.5, region: REGIONS.SOUTH_CHINA_SEA, baselineRisk: 0.1 },
  { id: "origin-display-kr-cn", label: "Display Panels — Korea/China Fabs", lat: 36.5, lng: 122.0, region: REGIONS.EAST_ASIA, baselineRisk: 0.09 },
  { id: "origin-copper-cl", label: "Copper — Chilean Mines", lat: -24.3, lng: -69.1, region: REGIONS.PANAMA, baselineRisk: 0.1 },
];

// ---------------------------------------------------------------------------
// Tier-2 dependency rules: supplier country → typical upstream dependencies.
// sharePct mimics Comtrade import-concentration figures for Chapter 85 inputs.
// ---------------------------------------------------------------------------
export interface DependencyRule {
  originId: string;
  material: string;
  sharePct: number;
  description: string;
}

export const COUNTRY_DEPENDENCY_RULES: Record<string, DependencyRule[]> = {
  germany: [
    { originId: "origin-polysilicon-ea", material: "Polysilicon", sharePct: 75, description: "Sourcing 75% Polysilicon from East Asia Hub" },
    { originId: "origin-wafers-tw", material: "Semiconductor Wafers", sharePct: 60, description: "Sourcing 60% logic wafers from Hsinchu cluster (Taiwan)" },
    { originId: "origin-rare-earth-cn", material: "Rare Earths", sharePct: 68, description: "Sourcing 68% rare-earth magnets from Inner Mongolia" },
  ],
  china: [
    { originId: "origin-polysilicon-ea", material: "Polysilicon", sharePct: 85, description: "Sourcing 85% polysilicon domestically from East Asia Hub" },
    { originId: "origin-cobalt-drc", material: "Cobalt", sharePct: 70, description: "Sourcing 70% battery-grade cobalt from DRC Copperbelt" },
    { originId: "origin-photoresist-jp", material: "Photoresist", sharePct: 55, description: "Sourcing 55% photoresist chemicals from Japan" },
  ],
  taiwan: [
    { originId: "origin-photoresist-jp", material: "Photoresist", sharePct: 80, description: "Sourcing 80% photoresist & wafer chemicals from Japan" },
    { originId: "origin-rare-earth-cn", material: "Rare Earths", sharePct: 50, description: "Sourcing 50% rare-earth inputs from Inner Mongolia" },
  ],
  "south korea": [
    { originId: "origin-photoresist-jp", material: "Photoresist", sharePct: 85, description: "Sourcing 85% photoresist from Japan (export-control sensitive)" },
    { originId: "origin-cobalt-drc", material: "Cobalt", sharePct: 64, description: "Sourcing 64% cobalt precursor from DRC Copperbelt" },
  ],
  japan: [
    { originId: "origin-rare-earth-cn", material: "Rare Earths", sharePct: 58, description: "Sourcing 58% rare-earth elements from Inner Mongolia" },
    { originId: "origin-lithium-sa", material: "Lithium", sharePct: 45, description: "Sourcing 45% lithium carbonate from South America Triangle" },
  ],
  "united states": [
    { originId: "origin-wafers-tw", material: "Advanced Logic", sharePct: 72, description: "Sourcing 72% advanced logic chips from Hsinchu cluster (Taiwan)" },
    { originId: "origin-pcb-cn", material: "PCB Assemblies", sharePct: 55, description: "Sourcing 55% PCB assemblies from Pearl River Delta" },
  ],
  vietnam: [
    { originId: "origin-display-kr-cn", material: "Display Panels", sharePct: 66, description: "Sourcing 66% display panels from Korea/China fabs" },
    { originId: "origin-pcb-cn", material: "PCB & Passives", sharePct: 74, description: "Sourcing 74% PCB & passive components from Pearl River Delta" },
  ],
  malaysia: [
    { originId: "origin-wafers-tw", material: "Wafers", sharePct: 52, description: "Sourcing 52% wafers for OSAT packaging from Taiwan" },
    { originId: "origin-pcb-cn", material: "Substrates", sharePct: 48, description: "Sourcing 48% IC substrates from Pearl River Delta" },
  ],
  india: [
    { originId: "origin-display-kr-cn", material: "Display Panels", sharePct: 78, description: "Sourcing 78% display modules from Korea/China fabs" },
    { originId: "origin-pcb-cn", material: "PCB Assemblies", sharePct: 70, description: "Sourcing 70% populated PCBs from Pearl River Delta" },
  ],
  mexico: [
    { originId: "origin-pcb-cn", material: "PCB Assemblies", sharePct: 62, description: "Sourcing 62% PCB assemblies from Pearl River Delta" },
    { originId: "origin-copper-cl", material: "Copper", sharePct: 40, description: "Sourcing 40% copper wiring stock from Chilean mines" },
  ],
  netherlands: [
    { originId: "origin-wafers-tw", material: "Wafers", sharePct: 45, description: "Sourcing 45% test wafers from Hsinchu cluster (Taiwan)" },
    { originId: "origin-rare-earth-cn", material: "Rare Earths", sharePct: 55, description: "Sourcing 55% rare-earth components from Inner Mongolia" },
  ],
  italy: [
    { originId: "origin-wafers-tw", material: "Semiconductor Wafers", sharePct: 58, description: "Sourcing 58% wafers from Hsinchu cluster (Taiwan)" },
    { originId: "origin-pcb-cn", material: "PCB & Passives", sharePct: 65, description: "Sourcing 65% PCB & passive components from Pearl River Delta" },
  ],
};

// Fallback for countries with no explicit rule — keeps the graph connected.
export const GENERIC_DEPENDENCY_RULES: DependencyRule[] = [
  { originId: "origin-pcb-cn", material: "PCB & Passives", sharePct: 50, description: "Sourcing ~50% PCB & passive components from Pearl River Delta (regional default)" },
  { originId: "origin-memory-kr", material: "Memory & MLCC", sharePct: 40, description: "Sourcing ~40% memory & MLCC from Korea cluster (regional default)" },
];

// ---------------------------------------------------------------------------
// Route topology: which ports/chokepoints connect an origin to a supplier
// country. Expressed as per-country inbound lanes; the graph builder stitches
// origin → lane ports → supplier.
// ---------------------------------------------------------------------------
export interface LaneSeed {
  /** Ordered port/route node ids the lane traverses. */
  via: string[];
  mode: TransportMode;
}

/**
 * Canonical per-mode leg parameters. Each leg's lead time and freight are
 * derived deterministically from great-circle distance and these rates, so
 * a leg shared by several lanes/suppliers always gets identical values
 * regardless of processing order (QC-4 fix). Values are calibration stubs
 * pending live data; they intentionally include handling/customs overhead
 * (e.g. rail's high days-per-km reflects the full Eurasia corridor length
 * that the simplified two-waypoint chain under-measures).
 */
export const MODE_PARAMS: Record<
  TransportMode,
  { daysPer1000Km: number; handlingDays: number; freightPer1000Km: number }
> = {
  sea: { daysPer1000Km: 1.35, handlingDays: 0.6, freightPer1000Km: 0.37 },
  rail: { daysPer1000Km: 3.2, handlingDays: 1.5, freightPer1000Km: 2.4 },
  air: { daysPer1000Km: 0.15, handlingDays: 1.0, freightPer1000Km: 2.7 },
  road: { daysPer1000Km: 1.0, handlingDays: 0.5, freightPer1000Km: 0.5 },
};

/**
 * Inbound lanes by destination macro-geography. The graph builder picks the
 * geography from the supplier country, then wires each Tier-2 origin through
 * every available lane so the pathfinder has real alternatives to reroute to.
 */
export const INBOUND_LANES: Record<string, LaneSeed[]> = {
  europe: [
    { via: ["port-shanghai", "route-malacca", "route-suez", "port-rotterdam"], mode: "sea" },
    { via: ["port-shenzhen", "route-malacca", "route-suez", "port-hamburg"], mode: "sea" },
    { via: ["rail-eurasia", "port-hamburg"], mode: "rail" },
    { via: ["air-hub-global", "port-rotterdam"], mode: "air" },
  ],
  "north-america": [
    { via: ["port-shanghai", "port-la-lb"], mode: "sea" },
    { via: ["port-busan", "port-oakland"], mode: "sea" },
    { via: ["port-shenzhen", "route-panama", "port-la-lb"], mode: "sea" },
    { via: ["air-hub-global", "port-la-lb"], mode: "air" },
  ],
  asia: [
    { via: ["port-shanghai"], mode: "sea" },
    { via: ["port-singapore", "route-malacca"], mode: "sea" },
    { via: ["port-kaohsiung"], mode: "sea" },
    { via: ["air-hub-global"], mode: "air" },
  ],
  "rest-of-world": [
    { via: ["port-singapore", "route-malacca"], mode: "sea" },
    { via: ["port-shanghai", "route-malacca", "route-suez"], mode: "sea" },
    { via: ["air-hub-global"], mode: "air" },
  ],
};

const EUROPE = new Set([
  "germany", "france", "united kingdom", "uk", "great britain", "netherlands",
  "belgium", "italy", "spain", "portugal", "switzerland", "austria",
  "czech republic", "czechia", "poland", "hungary", "slovakia", "romania",
  "sweden", "denmark", "norway", "finland", "ireland", "estonia", "turkey",
]);
const NORTH_AMERICA = new Set([
  "united states", "usa", "us", "united states of america", "canada", "mexico",
]);
const ASIA = new Set([
  "china", "taiwan", "japan", "south korea", "korea", "republic of korea",
  "singapore", "malaysia", "thailand", "vietnam", "viet nam", "philippines",
  "indonesia", "india", "bangladesh", "sri lanka",
]);

export function laneGeographyFor(countryNormalized: string): keyof typeof INBOUND_LANES {
  if (EUROPE.has(countryNormalized)) return "europe";
  if (NORTH_AMERICA.has(countryNormalized)) return "north-america";
  if (ASIA.has(countryNormalized)) return "asia";
  return "rest-of-world";
}

export function portSeedToNode(p: PortSeed): GraphNode {
  return {
    id: p.id,
    kind: "port",
    label: p.label,
    lat: p.lat,
    lng: p.lng,
    region: p.region,
    baselineRisk: p.baselineRisk,
  };
}

export function originSeedToNode(o: OriginSeed): GraphNode {
  return {
    id: o.id,
    kind: "raw-origin",
    label: o.label,
    lat: o.lat,
    lng: o.lng,
    region: o.region,
    baselineRisk: o.baselineRisk,
  };
}
