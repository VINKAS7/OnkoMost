import dagre from "@dagrejs/dagre";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { fmtDate } from "../api";
import { useApp } from "../ctx";
import type { PathwayGraph, PathwayNode } from "../types";

type Data = { node: PathwayNode; mark?: "added" | "changed"; selected?: boolean; plain: boolean };

const W = 200, H = 52, TW = 140, TH = 38;

/** Visual class + dot colour of a step: documents → green/red/yellow; process steps → done/to-do; decisions purple. */
export function nodeClass(n: PathwayNode, plain: boolean): { cls: string; dot: string } {
  if (n.type === "treatment") return { cls: `treatment ${n.status === "done" ? "chosen" : ""} ${n.status === "skipped" ? "skipped" : ""}`, dot: "" };
  if (plain) {
    if (n.type === "decision") return { cls: "decision", dot: "purple" };
    if (n.type === "mdt") return { cls: "mdt", dot: "blue" };
    return { cls: "", dot: n.completion === "evidence" ? "orange" : "gray" };
  }
  if (n.status === "skipped") return { cls: "skipped", dot: "gray" };
  if (n.completion === "evidence") {
    const ds = n.doc_status ?? "missing";
    return { cls: ds, dot: ({ have: "green", missing: "red", conflict: "yellow" } as Record<string, string>)[ds] ?? "gray" };
  }
  if (n.type === "decision") return { cls: `decision ${n.status !== "done" && n.conditional ? "conditional" : ""}`, dot: "purple" };
  if (n.type === "mdt") return { cls: "mdt", dot: n.status === "done" ? "green" : "blue" };
  if (n.status === "done") return { cls: "proc-done", dot: "green" };
  if (n.status === "available") return { cls: "proc-todo", dot: "blue" };
  return { cls: n.conditional ? "conditional" : "", dot: "gray" };
}

function FlowNode({ data }: NodeProps<Node<Data>>) {
  const { pick, t } = useApp();
  const n = data.node;
  const { cls, dot } = nodeClass(n, data.plain);
  const label = pick(n.label, n.label_en);
  if (n.type === "treatment") {
    return (
      <div className={`fnode ${cls} ${data.selected ? "sel" : ""} ${data.mark ?? ""}`} title={label}>
        <Handle type="target" position={Position.Top} />
        <div className="lbl">{label}</div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }
  // one short line under the label
  let sub = "";
  if (!data.plain) {
    if (n.completion === "evidence" && n.doc_status) {
      sub = n.doc_status === "have" && n.evidence?.[0] ? fmtDate(n.evidence[0].date) : t(`doc.${n.doc_status}`);
    } else if (n.type === "decision" && n.detail?.keys?.length) {
      sub = n.detail.keys.map((k) => { const b = n.branches?.find((x) => x.key === k); return pick(b?.label, b?.label_en); }).join(", ");
    } else if (n.status === "done" && n.done_on) sub = fmtDate(n.done_on);
    else if (n.status === "available" && n.due_on) sub = `${t("due")} ${fmtDate(n.due_on)}`;
  } else if (n.blocking === false) sub = t("pw.optional");
  return (
    <div className={`fnode ${cls} ${data.selected ? "sel" : ""} ${data.mark ?? ""}`} title={n.description || label}>
      <Handle type="target" position={Position.Top} />
      <span className={`dot ${dot}`} style={{ marginTop: 5 }} />
      <div className="grow">
        <div className="lbl">{label}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { pathway: FlowNode };

export function layout(graph: PathwayGraph): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 22, ranksep: 46, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((n) => g.setNode(n.id, n.type === "treatment" ? { width: TW, height: TH } : { width: W, height: H }));
  graph.edges.forEach((e) => { if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target); });
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  graph.nodes.forEach((n) => {
    const p = g.node(n.id);
    const w = n.type === "treatment" ? TW : W, h = n.type === "treatment" ? TH : H;
    out[n.id] = { x: (p?.x ?? 0) - w / 2, y: (p?.y ?? 0) - h / 2 };
  });
  return out;
}

export function FlowLegend({ plain }: { plain?: boolean }) {
  const { t } = useApp();
  const items: [string, string][] = plain
    ? [["orange", t("pw.evidence")], ["purple", t("kind.decision")], ["blue", "MDT"]]
    : [["green", t("doc.have")], ["red", t("doc.missing")], ["yellow", t("doc.conflict")], ["blue", t("step.todo")], ["purple", t("kind.decision")]];
  return <div className="legend">{items.map(([c, l]) => <span key={l}><span className={`dot ${c}`} />{l}</span>)}</div>;
}

export function PathwayFlow({
  graph, plain = false, marks, selectedId, onSelect, editable, onConnect, onDeleteEdge, height = 680,
}: {
  graph: PathwayGraph; plain?: boolean;
  marks?: Record<string, "added" | "changed">;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  editable?: boolean;
  onConnect?: (c: Connection) => void;
  onDeleteEdge?: (source: string, target: string) => void;
  height?: number;
}) {
  const { pick } = useApp();
  const pos = useMemo(() => layout(graph), [graph]);
  // size the canvas to the graph so labels stay readable (min zoom ~0.75) instead of shrinking everything to fit
  const graphH = useMemo(() => Math.max(...Object.values(pos).map((p) => p.y)) + H + 40, [pos]);
  const h = Math.min(Math.max(height, Math.round(graphH * 0.78)), 1500);
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);
  const nodes: Node<Data>[] = graph.nodes.map((n) => ({
    id: n.id, type: "pathway", position: pos[n.id], draggable: false, connectable: !!editable,
    data: { node: n, mark: marks?.[n.id], selected: n.id === selectedId, plain },
  }));
  const edges: Edge[] = graph.edges.map((e) => {
    const src = byId[e.source], dst = byId[e.target];
    const skipped = !plain && (dst?.status === "skipped" || src?.status === "skipped");
    const chosen = !plain && !!e.branch && dst?.status !== "skipped" && src?.status === "done";
    const done = !plain && src?.status === "done" && !skipped;
    const color = chosen ? "var(--blue)" : done ? "#8a8a86" : "#c4c4c0";
    const b = e.branch ? src?.branches?.find((x) => x.key === e.branch) : undefined;
    // treatment boxes already carry the option name – only label the other branches (e.g. lung route)
    const branchLabel = dst?.type === "treatment" ? undefined : b ? pick(b.label, b.label_en) : e.label;
    return {
      id: `${e.source}->${e.target}`, source: e.source, target: e.target, type: "smoothstep",
      pathOptions: { borderRadius: 12 },
      label: branchLabel || undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
      animated: !plain && dst?.status === "available",
      style: { stroke: color, strokeWidth: chosen ? 2.2 : 1.4, strokeDasharray: skipped ? "4 4" : undefined, opacity: skipped ? 0.5 : 1 },
      labelStyle: { fontSize: 11, fill: "var(--muted)", fontWeight: 500 },
      labelBgStyle: { fill: "var(--bg)" }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4,
    };
  });
  return (
    <div className="flow" style={{ height: h }}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.04, minZoom: 0.66, maxZoom: 1 }} minZoom={0.2} maxZoom={1.6}
        nodesConnectable={!!editable} onConnect={onConnect}
        onNodeClick={(_, n) => onSelect?.(n.id)} onPaneClick={() => onSelect?.(null)}
        onEdgeDoubleClick={editable ? (_, e) => onDeleteEdge?.(e.source, e.target) : undefined}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} color="var(--line)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
