"use client";

// Canvas A — geospatial view. Leaflet with dark Carto tiles: supplier pins,
// port/origin markers colored by live effective risk, mock climate &
// infrastructure risk-zone heat overlay, and highlighted alternative paths.

import { useEffect, useMemo } from "react";
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import { useAppStore } from "@/lib/store";
import { riskColor, riskLabel } from "@/lib/utils";
import type { GraphNode } from "@/lib/types";

// Bundled world outline so the map stays legible even when the tile CDN is
// unreachable (offline demos, restricted networks). Tiles draw on top.
const topo = worldTopo as unknown as Topology<{ countries: GeometryCollection }>;
const WORLD_OUTLINE = feature(topo, topo.objects.countries) as FeatureCollection;

function effectiveNodeRisk(
  node: GraphNode,
  severity: Record<string, number>,
): number {
  const injected = node.region ? (severity[node.region] ?? 0) : 0;
  return Math.min(2.5, node.baselineRisk + injected);
}

/** Pans the map to the node selected on either canvas. */
function FlyToSelection() {
  const map = useMap();
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const nodesById = useAppStore((s) => s.nodesById);

  useEffect(() => {
    if (!selectedNodeId) return;
    const n = nodesById.get(selectedNodeId);
    if (n && (n.lat !== 0 || n.lng !== 0)) {
      map.flyTo([n.lat, n.lng], Math.max(map.getZoom(), 4), { duration: 0.8 });
    }
  }, [selectedNodeId, nodesById, map]);

  return null;
}

export default function GeoMap() {
  const dataset = useAppStore((s) => s.dataset);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const select = useAppStore((s) => s.select);
  const severity = useAppStore((s) => s.regionSeverity);
  const highlightedPath = useAppStore((s) => s.highlightedPath);
  const nodesById = useAppStore((s) => s.nodesById);

  const nodes = dataset?.graph.nodes ?? [];
  const riskZones = dataset?.riskZones ?? [];

  const pathLatLngs = useMemo(() => {
    if (!highlightedPath) return null;
    const pts = highlightedPath.nodeIds
      .map((id) => nodesById.get(id))
      .filter((n): n is GraphNode => !!n && (n.lat !== 0 || n.lng !== 0))
      .map((n) => [n.lat, n.lng] as [number, number]);
    return pts.length >= 2 ? pts : null;
  }, [highlightedPath, nodesById]);

  const markerFor = (n: GraphNode) => {
    if (n.lat === 0 && n.lng === 0) return null;
    const selected = n.id === selectedNodeId;
    const onPath = highlightedPath?.nodeIds.includes(n.id) ?? false;
    const eff = effectiveNodeRisk(n, severity);

    const style =
      n.kind === "supplier"
        ? { radius: selected ? 11 : 8, color: "#38bdf8", fill: "#0ea5e9" }
        : n.kind === "raw-origin"
          ? { radius: selected ? 9 : 6, color: "#f59e0b", fill: "#d97706" }
          : n.kind === "hub"
            ? { radius: selected ? 10 : 7, color: "#a78bfa", fill: "#8b5cf6" }
            : { radius: selected ? 8 : 5, color: riskColor(eff), fill: riskColor(eff) };

    return (
      <CircleMarker
        key={n.id}
        center={[n.lat, n.lng]}
        radius={style.radius}
        pathOptions={{
          color: selected ? "#fbbf24" : onPath ? "#e2e8f0" : style.color,
          weight: selected ? 3 : onPath ? 2.5 : 1.5,
          fillColor: style.fill,
          fillOpacity: selected ? 0.95 : 0.75,
        }}
        eventHandlers={{ click: () => select(n.id) }}
      >
        <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
          <div className="text-xs">
            <div className="font-semibold">{n.label}</div>
            <div>
              {n.kind === "supplier"
                ? `Tier-1 supplier · ${n.country ?? ""}`
                : n.kind === "raw-origin"
                  ? "Tier-2 raw material origin"
                  : n.kind === "hub"
                    ? "Destination hub"
                    : `Trade route / port · ${n.region ?? ""}`}
            </div>
            <div>
              Risk: {riskLabel(eff)} ({Math.round(eff * 100)}%)
            </div>
          </div>
        </Tooltip>
      </CircleMarker>
    );
  };

  return (
    <MapContainer
      center={[24, 40]}
      zoom={2}
      minZoom={2}
      className="h-full w-full"
      style={{ background: "#0b1220" }}
      worldCopyJump
      attributionControl={false}
    >
      <GeoJSON
        data={WORLD_OUTLINE}
        style={{
          color: "#1e293b",
          weight: 0.7,
          fillColor: "#111c30",
          fillOpacity: 1,
          interactive: false,
        }}
      />
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        opacity={0.9}
      />
      <FlyToSelection />

      {/* Climate & infrastructure risk heat overlay */}
      {riskZones.map((z) => {
        const zoneSeverity = Math.min(1, z.severity + (z.region ? (severity[z.region] ?? 0) : 0));
        const color = riskColor(zoneSeverity);
        return (
          <Circle
            key={z.id}
            center={[z.lat, z.lng]}
            radius={z.radiusKm * 1000}
            pathOptions={{
              color,
              weight: 1,
              dashArray: "6 6",
              fillColor: color,
              fillOpacity: 0.1 + zoneSeverity * 0.18,
            }}
          >
            <Tooltip direction="center" opacity={0.95}>
              <div className="text-xs">
                <div className="font-semibold">{z.name}</div>
                <div>
                  {z.kind} · severity {Math.round(zoneSeverity * 100)}%
                </div>
              </div>
            </Tooltip>
          </Circle>
        );
      })}

      {/* Highlighted alternative path */}
      {pathLatLngs && (
        <Polyline
          positions={pathLatLngs}
          pathOptions={{ color: "#e2e8f0", weight: 3, dashArray: "10 6", opacity: 0.9 }}
        />
      )}

      {nodes.map(markerFor)}
    </MapContainer>
  );
}
