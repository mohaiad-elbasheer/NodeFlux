// Core domain types shared by the ingestion backend, the graph engine,
// and the client-side visualization/simulation layers.

/** A single validated + enriched Tier-1 supplier row from the analyst's CSV. */
export interface SupplierRow {
  id: string;
  supplierName: string;
  countryOfOrigin: string;
  city: string;
  productDescription: string;
  hsCodeChapter85: string;
  estimatedLeadTimeDays: number;
  lat: number;
  lng: number;
  /** True when lat/lng came from a country-centroid fallback rather than a city match. */
  geocodeApproximate: boolean;
  tier2Dependencies: Tier2Dependency[];
  /** Non-fatal issues found while parsing this row (defaults applied). */
  warnings: string[];
}

/** Mock UN-Comtrade-derived upstream dependency injected during enrichment. */
export interface Tier2Dependency {
  description: string; // e.g. "Sourcing 75% Polysilicon from East Asia Hub"
  originNodeId: string; // raw-material origin node in the DAG
  sharePct: number; // dependency concentration (0-100)
  material: string;
}

export type NodeKind = "raw-origin" | "port" | "supplier" | "hub";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  lat: number;
  lng: number;
  country?: string;
  /** Bottleneck region tag used by the simulation slider (ports/origins). */
  region?: string;
  /** Baseline macro risk 0..1 derived from active risk zones. */
  baselineRisk: number;
  /** Supplier nodes carry their source row id. */
  supplierId?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Days of transit/production this leg contributes before risk inflation. */
  baseLeadTime: number;
  /** Static freight cost expressed in weight-equivalent units. */
  staticFreightCost: number;
  /** Baseline macro risk 0..1 from risk zones along the leg (pre-simulation). */
  baselineRisk: number;
  /** Transport mode, for the analyst report ("sea" | "air" | "rail" | "road"). */
  mode: TransportMode;
  /**
   * Bottleneck regions this leg is exposed to (endpoint regions united).
   * Slider severities for ALL listed regions add up on this edge.
   */
  regions: string[];
}

export type TransportMode = "sea" | "air" | "rail" | "road";

export interface SupplyChainGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Mock climate/infrastructure risk zone rendered as a heat overlay on the map. */
export interface RiskZone {
  id: string;
  name: string;
  kind: "typhoon" | "port-congestion" | "geopolitical" | "drought";
  lat: number;
  lng: number;
  radiusKm: number;
  severity: number; // 0..1 baseline severity
  /** Bottleneck region this zone maps to, if slider-controllable. */
  region?: string;
}

/** The full dataset held by the server datastore and hydrated into the client. */
export interface Dataset {
  /** Bumped when the graph schema changes; stale snapshots are discarded. */
  schemaVersion: number;
  uploadedAt: string;
  sourceFileName: string;
  suppliers: SupplierRow[];
  graph: SupplyChainGraph;
  riskZones: RiskZone[];
  /** File-level warnings (skipped rows, unknown headers...). */
  warnings: string[];
}

/** Client simulation state: severity per bottleneck region, 0..1. */
export type RegionSeverity = Record<string, number>;

export interface PathResult {
  nodeIds: string[];
  edgeIds: string[];
  totalWeight: number;
  totalLeadTimeDays: number;
  totalFreightCost: number;
  /** Sum of effective risk exposure along the path. */
  vulnerabilityScore: number;
  /** Bottleneck regions this path traverses. */
  regionsTraversed: string[];
}

export interface SupplierRouting {
  supplierId: string;
  originNodeId: string;
  /** Ranked best-first; [0] is the recommended path. */
  paths: PathResult[];
}
