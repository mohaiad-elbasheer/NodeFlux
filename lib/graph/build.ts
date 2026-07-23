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
  MODE_PARAMS,
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
      regions: [],
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

        // Each leg is derived deterministically from great-circle distance
        // and canonical per-mode rates, so shared legs get identical values
        // no matter which supplier/lane touched them first. The final
        // port -> supplier leg is always ground delivery.
        const pts = chainIds.map((id) => nodes.get(id)!);
        pts.slice(1).forEach((target, i) => {
          const from = pts[i];
          const mode = i === pts.length - 2 ? "road" : lane.mode;
          const mp = MODE_PARAMS[mode];
          const dist = Math.max(50, haversineKm(from.lat, from.lng, target.lat, target.lng));
          const regions = Array.from(
            new Set([from.region, target.region].filter((r): r is string => !!r)),
          );
          addEdge({
            source: from.id,
            target: target.id,
            baseLeadTime:
              Math.round((mp.handlingDays + (dist * mp.daysPer1000Km) / 1000) * 10) / 10,
            staticFreightCost: Math.max(
              0.5,
              Math.round(((dist * mp.freightPer1000Km) / 1000) * 10) / 10,
            ),
            mode,
            regions,
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
