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
import type { LatLngBoundsExpression } from "leaflet";
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

// Constrain panning to a single world so tiles/markers never wrap or reveal
// grey/black void beyond the map edges.
const WORLD_BOUNDS: LatLngBoundsExpression = [
  [-85, -180],
  [85, 180],
];

/**
 * Great-circle interpolation between two points (spherical slerp), split
 * into separate polyline segments wherever the arc crosses the antimeridian
 * so Leaflet never draws a world-spanning straight line.
 */
function greatCircleSegments(
  a: [number, number],
  b: [number, number],
  steps = 48,
): [number, number][][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lat1, lng1] = [toRad(a[0]), toRad(a[1])];
  const [lat2, lng2] = [toRad(b[0]), toRad(b[1])];

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );
  if (d < 1e-9) return [[a, b]];

  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }

  const segments: [number, number][][] = [];
  let current: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][1] - pts[i - 1][1]) > 180) {
      segments.push(current);
      current = [];
    }
    current.push(pts[i]);
  }
  if (current.length > 1) segments.push(current);
  return segments.filter((s) => s.length > 1);
}

function effectiveNodeRisk(
  node: GraphNode,
  severity: Record<string, number>,
): number {
  const injected = node.region ? (severity[node.region] ?? 0) : 0;
  return Math.min(2.5, node.baselineRisk + injected);
}

/**
 * Keeps Leaflet's internal size in sync with its container. Leaflet only
 * recomputes size on window resize, so flexbox changes from the Map/Split/
 * Graph toggle leave the map rendered at a stale width (black gutter,
 * mis-positioned tiles). A ResizeObserver + a viewMode-driven pass fix it.
 */
function MapResizer() {
  const map = useMap();
  const viewMode = useAppStore((s) => s.viewMode);

  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);

  useEffect(() => {
    // Run after the flexbox layout for the new mode has settled.
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 60);
    return () => clearTimeout(t);
  }, [map, viewMode]);

  return null;
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

  const pathSegments = useMemo(() => {
    if (!highlightedPath) return null;
    const pts = highlightedPath.nodeIds
      .map((id) => nodesById.get(id))
      .filter((n): n is GraphNode => !!n && (n.lat !== 0 || n.lng !== 0))
      .map((n) => [n.lat, n.lng] as [number, number]);
    if (pts.length < 2) return null;
    const segments: [number, number][][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      for (const seg of greatCircleSegments(pts[i], pts[i + 1])) segments.push(seg);
    }
    return segments;
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
      maxZoom={7}
      className="h-full w-full"
      style={{ background: "#0b1220" }}
      maxBounds={WORLD_BOUNDS}
      maxBoundsViscosity={1}
      attributionControl={false}
    >
      {/* Bundled vector world as the always-present base — legible with or
          without tiles, so a blocked/slow CDN never leaves a blank/black map. */}
      <GeoJSON
        data={WORLD_OUTLINE}
        style={{
          color: "#334155",
          weight: 0.6,
          fillColor: "#152238",
          fillOpacity: 1,
          interactive: false,
        }}
      />
      {/* Street tiles layered on top; noWrap avoids the repeated-world smear,
          and a load-error handler blanks failed tiles instead of black boxes. */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
        opacity={0.85}
        noWrap
        eventHandlers={{
          tileerror: (e) => {
            const img = e.tile as HTMLImageElement;
            img.style.visibility = "hidden";
          },
        }}
      />
      <MapResizer />
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

      {/* Highlighted alternative path (great-circle arcs) */}
      {pathSegments?.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg}
          pathOptions={{ color: "#e2e8f0", weight: 3, dashArray: "10 6", opacity: 0.9 }}
        />
      ))}

      {nodes.map(markerFor)}
    </MapContainer>
  );
}
