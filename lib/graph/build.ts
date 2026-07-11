// Builds the supply-chain DAG from enriched supplier rows + trade seed data.
//
// Topology per supplier:
//   [Raw Material Origin] -> [Port / Trade Route ...] -> [Tier-1 Supplier] -> [Your DC]
//
// Every Tier-2 origin is wired through EVERY inbound lane available for the
// supplier's geography, so the pathfinder always has genuine alternatives
// (sea via Suez, sea via Panama, Eurasia rail, air) to reroute across.

import {
  INBOUND_LANES,
  ORIGINS,
  PORTS,
  laneGeographyFor,
  originSeedToNode,
  portSeedToNode,
} from "@/data/comtrade-seed";
import { RISK_ZONES } from "@/data/risk-zones";
import { canonicalCountry } from "../enrich";
import { normalizePlace } from "../geocode";
import type {
  GraphEdge,
  GraphNode,
  RiskZone,
  SupplierRow,
  SupplyChainGraph,
} from "../types";

export const HUB_NODE_ID = "hub-central-dc";

const EARTH_RADIUS_KM = 6371;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/** Risk-zone contribution at a point: linear falloff from zone center. */
function zoneRiskAt(lat: number, lng: number, zones: RiskZone[]): number {
  let max = 0;
  for (const z of zones) {
    const d = haversineKm(lat, lng, z.lat, z.lng);
    if (d < z.radiusKm) {
      max = Math.max(max, z.severity * (1 - d / z.radiusKm));
    }
  }
  return max;
}

export function buildGraph(suppliers: SupplierRow[]): SupplyChainGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const portById = new Map(PORTS.map((p) => [p.id, p]));
  const originById = new Map(ORIGINS.map((o) => [o.id, o]));

  const addNode = (n: GraphNode) => {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, {
        ...n,
        baselineRisk: Math.min(0.9, Math.max(n.baselineRisk, zoneRiskAt(n.lat, n.lng, RISK_ZONES))),
      });
    }
  };

  const addEdge = (e: Omit<GraphEdge, "id" | "baselineRisk">) => {
    const id = `${e.source}->${e.target}`;
    if (edges.has(id)) return;
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    const baselineRisk = Math.max(s?.baselineRisk ?? 0, t?.baselineRisk ?? 0);
    edges.set(id, { ...e, id, baselineRisk });
  };

  // Central DC sink so every supplier terminates in a routable destination.
  addNode({
    id: HUB_NODE_ID,
    kind: "hub",
    label: "Central Distribution Hub",
    lat: 45.46,
    lng: 9.19,
    baselineRisk: 0.02,
  });

  for (const supplier of suppliers) {
    addNode({
      id: supplier.id,
      kind: "supplier",
      label: supplier.supplierName,
      lat: supplier.lat,
      lng: supplier.lng,
      country: supplier.countryOfOrigin,
      baselineRisk: 0.05,
      supplierId: supplier.id,
    });

    // Last-mile: the supplier's own production/dispatch lead time.
    addEdge({
      source: supplier.id,
      target: HUB_NODE_ID,
      baseLeadTime: supplier.estimatedLeadTimeDays,
      staticFreightCost: 3,
      mode: "road",
    });

    const geography = laneGeographyFor(
      canonicalCountry(normalizePlace(supplier.countryOfOrigin)),
    );
    const lanes = INBOUND_LANES[geography];

    for (const dep of supplier.tier2Dependencies) {
      const originSeed = originById.get(dep.originNodeId);
      if (!originSeed) continue;
      addNode(originSeedToNode(originSeed));

      for (const lane of lanes) {
        // Chain: origin -> via[0] -> ... -> via[n-1] -> supplier
        const chainIds = [originSeed.id, ...lane.via, supplier.id];

        for (const portId of lane.via) {
          const port = portById.get(portId);
          if (port) addNode(portSeedToNode(port));
        }

        // Distribute lane transit days & freight across legs by distance.
        const pts = chainIds.map((id) => nodes.get(id)!);
        const legDists = pts.slice(1).map((p, i) =>
          Math.max(50, haversineKm(pts[i].lat, pts[i].lng, p.lat, p.lng)),
        );
        const total = legDists.reduce((a, b) => a + b, 0);

        pts.slice(1).forEach((target, i) => {
          addEdge({
            source: pts[i].id,
            target: target.id,
            baseLeadTime: Math.max(1, Math.round(lane.transitDays * (legDists[i] / total))),
            staticFreightCost: Math.max(
              1,
              Math.round(lane.freightCost * (legDists[i] / total) * 10) / 10,
            ),
            mode: lane.mode,
          });
        });
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}
