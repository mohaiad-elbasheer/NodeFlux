"use client";

// Canvas B — relational node graph. React Flow DAG with layered layout:
// raw-material origins → ports/trade routes → Tier-1 suppliers → hub.
// Edge color/width react live to the simulation severity state.

import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Anchor, Building2, Factory, Mountain } from "lucide-react";
import { layeredLayout } from "@/lib/graph/layout";
import { effectiveEdgeRisk, edgeWeight } from "@/lib/graph/engine";
import { useAppStore } from "@/lib/store";
import { riskColor } from "@/lib/utils";
import type { GraphNode } from "@/lib/types";

type FlowNodeData = {
  label: string;
  kind: GraphNode["kind"];
  region?: string;
  country?: string;
  selected: boolean;
  onPath: boolean;
  [key: string]: unknown;
};

const KIND_META: Record<
  GraphNode["kind"],
  { icon: typeof Factory; ring: string; chip: string; title: string }
> = {
  "raw-origin": {
    icon: Mountain,
    ring: "border-amber-500/50",
    chip: "bg-amber-500/15 text-amber-300",
    title: "Raw Material",
  },
  port: {
    icon: Anchor,
    ring: "border-slate-600",
    chip: "bg-slate-600/30 text-slate-300",
    title: "Port / Route",
  },
  supplier: {
    icon: Factory,
    ring: "border-sky-500/50",
    chip: "bg-sky-500/15 text-sky-300",
    title: "Tier-1 Supplier",
  },
  hub: {
    icon: Building2,
    ring: "border-violet-500/50",
    chip: "bg-violet-500/15 text-violet-300",
    title: "Destination",
  },
};

function ChainNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const meta = KIND_META[data.kind];
  const Icon = meta.icon;
  return (
    <div
      className={`w-52 rounded-xl border bg-slate-900/95 px-3 py-2 shadow-lg transition-all ${
        data.selected
          ? "border-amber-400 ring-2 ring-amber-400/40"
          : data.onPath
            ? "border-slate-300/70 ring-1 ring-slate-300/30"
            : meta.ring
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center gap-2">
        <span className={`rounded-md p-1.5 ${meta.chip}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold leading-tight text-slate-100">
            {data.label}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            {meta.title}
            {data.region ? ` · ${data.region}` : data.country ? ` · ${data.country}` : ""}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-500" />
    </div>
  );
}

const nodeTypes = { chain: ChainNode };

export default function DependencyGraph() {
  const dataset = useAppStore((s) => s.dataset);
  const nodesById = useAppStore((s) => s.nodesById);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const select = useAppStore((s) => s.select);
  const severity = useAppStore((s) => s.regionSeverity);
  const highlightedPath = useAppStore((s) => s.highlightedPath);
  const engineMode = useAppStore((s) => s.engineMode);
  const edgeP95Ratio = useAppStore((s) => s.stochastic?.edgeP95Ratio);

  const positions = useMemo(
    () => (dataset ? layeredLayout(dataset.graph) : {}),
    [dataset],
  );

  const flowNodes: Node<FlowNodeData>[] = useMemo(() => {
    if (!dataset) return [];
    const onPath = new Set(highlightedPath?.nodeIds ?? []);
    return dataset.graph.nodes.map((n) => ({
      id: n.id,
      type: "chain",
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: {
        label: n.label,
        kind: n.kind,
        region: n.region,
        country: n.country,
        selected: n.id === selectedNodeId,
        onPath: onPath.has(n.id),
      },
    }));
  }, [dataset, positions, selectedNodeId, highlightedPath]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!dataset) return [];
    const onPath = new Set(highlightedPath?.edgeIds ?? []);
    return dataset.graph.edges.map((e) => {
      const detRisk = effectiveEdgeRisk(e, nodesById, severity);
      // Stochastic mode colors by tail risk: the edge's P95/modal lead-time
      // ratio from the Monte Carlo pass, mapped onto the same thresholds.
      const tailRatio = engineMode === "stochastic" ? edgeP95Ratio?.[e.id] : undefined;
      const risk = tailRatio !== undefined ? Math.max(0, (tailRatio - 1) / 2) : detRisk;
      const w = edgeWeight(e, detRisk);
      const highlighted = onPath.has(e.id);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: risk > 0.5 || highlighted,
        style: {
          stroke: highlighted ? "#e2e8f0" : riskColor(risk),
          strokeWidth: highlighted ? 3.5 : Math.min(5, 1 + w / 18),
          opacity: highlightedPath && !highlighted ? 0.25 : 0.85,
        },
      };
    });
  }, [dataset, nodesById, severity, highlightedPath, engineMode, edgeP95Ratio]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => select(null)}
      fitView
      minZoom={0.15}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      edgesFocusable={false}
      colorMode="dark"
    >
      <Background gap={24} color="#1e293b" />
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
}
