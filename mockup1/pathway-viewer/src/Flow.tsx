import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import type { Evaluation, NodeEval } from "./engine";
import type { Dict, Lang } from "./i18n";
import type { PNode, Pathway } from "./types";

export type Direction = "TB" | "LR";
const W = 230;
const H = 66;

const EDGE_STYLE: Record<string, { stroke: string; dash?: string; width?: number; opacity?: number }> = {
  done: { stroke: "var(--ok)", width: 1.8 },
  active: { stroke: "var(--info)", dash: "6 4", width: 2 },
  needed: { stroke: "var(--bad)", dash: "6 4", width: 1.8 },
  conflict: { stroke: "var(--warn)", width: 1.8 },
  open: { stroke: "var(--mute)", dash: "1 5" },
  optional: { stroke: "var(--mute)", dash: "4 4", opacity: 0.7 },
  pending: { stroke: "var(--mute)", dash: "4 4" },
  pruned: { stroke: "var(--mute)", dash: "2 6", opacity: 0.25 },
};

type StepData = { n: PNode; e: NodeEval; lang: Lang; t: Dict; dir: Direction; selected: boolean; highlight: boolean };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { n, e, lang, t, dir, selected, highlight } = data;
  const label = (lang === "en" && n.label_en) || n.label;
  let sub = t.v[e.vstate] ?? e.vstate;
  if (n.type === "decision" && e.chosen?.length) {
    sub = e.chosen.map((k) => { const b = n.branches?.find((x) => x.key === k); return (lang === "en" && b?.label_en) || b?.label || k; }).join(", ");
  }
  if (e.vstate === "gate_waiting") sub = `${e.blockers.length} ${t.missingFor}`;
  const badge = n.type === "decision" ? (n.decided_by === "rule" ? "rule" : "MDT/dr") : e.level && e.level !== "required" ? t.lv[e.level] : "";
  return (
    <div className={`step v-${e.vstate} t-${n.type} ${selected ? "sel" : ""} ${highlight ? "hl" : ""}`} title={n.description || label}>
      <Handle type="target" position={dir === "TB" ? Position.Top : Position.Left} />
      <div className="row">
        <span className={`dot d-${e.vstate}`} />
        <span className="lbl">{label}</span>
        {e.vstate === "undetermined" && <span className="q">?</span>}
      </div>
      <div className="sub">
        <span>{sub}</span>
        {badge && <span className="badge">{badge}</span>}
      </div>
      <Handle type="source" position={dir === "TB" ? Position.Bottom : Position.Right} />
    </div>
  );
}

const nodeTypes = { step: StepNode };

/** Layout depends only on the pathway and direction, not on the case state, so the chart doesn't jump while editing. */
function useLayout(p: Pathway, dir: Direction) {
  return useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: dir, nodesep: 28, ranksep: dir === "TB" ? 54 : 70, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of p.graph.nodes) g.setNode(n.id, { width: W, height: H });
    // keep a step next to its only predecessor (e.g. labs right after triage) instead of being pulled down to where
    // its result is consumed
    const indeg: Record<string, number> = {};
    for (const e of p.graph.edges) indeg[e.target] = (indeg[e.target] ?? 0) + 1;
    for (const e of p.graph.edges)
      if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, { weight: indeg[e.target] === 1 ? 4 : 1 });
    dagre.layout(g);
    return Object.fromEntries(p.graph.nodes.map((n) => {
      const { x, y } = g.node(n.id);
      return [n.id, { x: x - W / 2, y: y - H / 2 }];
    }));
  }, [p, dir]);
}

export default function Flow(props: {
  p: Pathway; ev: Evaluation; lang: Lang; t: Dict; dir: Direction;
  selected: string | null; highlight: Set<string>;
  onSelect: (id: string | null) => void; onCycle: (id: string) => void;
}) {
  const { p, ev, lang, t, dir, selected, highlight, onSelect, onCycle } = props;
  const pos = useLayout(p, dir);

  const nodes: Node<StepData>[] = useMemo(() => p.graph.nodes.map((n) => ({
    id: n.id, type: "step", position: pos[n.id], draggable: false,
    data: { n, e: ev.nodes[n.id], lang, t, dir, selected: n.id === selected, highlight: highlight.has(n.id) },
  })), [p, ev, lang, t, dir, selected, highlight, pos]);

  const edges: Edge[] = useMemo(() => {
    const branchLabel = (k: string) => {
      for (const n of p.graph.nodes) {
        const b = n.branches?.find((x) => x.key === k);
        if (b) return (lang === "en" && b.label_en) || b.label;
      }
      return k;
    };
    return ev.edges.map(({ edge, style }, i) => {
      const st = EDGE_STYLE[style];
      const keys = edge.branches ?? (edge.branch ? [edge.branch] : []);
      const isDecision = p.graph.nodes.find((n) => n.id === edge.source)?.type === "decision";
      const label = edge.label ?? (isDecision && keys.length ? keys.map(branchLabel).join(" / ") : undefined);
      return {
        id: `e${i}`, source: edge.source, target: edge.target, label, type: "smoothstep",
        animated: style === "active",
        style: { stroke: st.stroke, strokeDasharray: st.dash, strokeWidth: st.width ?? 1.3, opacity: st.opacity ?? 1 },
        labelStyle: { fontSize: 10, fill: "var(--fg2)" },
        labelBgStyle: { fill: "var(--bg)" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: st.stroke },
      };
    });
  }, [ev, p, lang]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView colorMode="system" minZoom={0.15} nodesConnectable={false}
      onNodeClick={(_, n) => onSelect(n.id)}
      onNodeDoubleClick={(_, n) => onCycle(n.id)}
      onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeClassName={(n) => `mm v-${(n.data as StepData).e.vstate}`} />
    </ReactFlow>
  );
}
