import dagre from "@dagrejs/dagre";
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Connection, type Edge, type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { fmtDate } from "../api";
import { useApp } from "../ctx";
import { useWidth } from "../facts";
import type { PathwayGraph, PathwayNode } from "../types";
import { Icon } from "./Icon";

type Data = { node: PathwayNode; mark?: "added" | "changed"; selected?: boolean; plain: boolean };

const W = 232, H = 92, TW = 168, TH = 40, MIN_ZOOM = 0.5;

/** Visual class + dot colour of a step: documents → green/red/yellow; process steps → done/to-do; decisions purple. */
export function nodeClass(n: PathwayNode, plain: boolean): { cls: string; dot: string } {
  if (n.type === "treatment") return { cls: `treatment ${n.status === "done" ? "chosen" : ""} ${n.status === "skipped" ? "skipped" : ""}`, dot: "" };
  if (plain) {
    if (n.type === "decision") return { cls: "decision", dot: "purple" };
    if (n.type === "mdt") return { cls: "mdt", dot: "teal" };
    return { cls: n.type === "end" ? "end" : "", dot: n.completion === "evidence" ? "orange" : "gray" };
  }
  if (n.doc_status === "waived") return { cls: "skipped", dot: "orange" };  // gone on without it: not "not needed"
  if (n.status === "skipped") return { cls: "skipped", dot: "gray" };
  if (n.completion === "evidence") {
    const ds = n.doc_status ?? "missing";
    return { cls: ds, dot: ({ have: "green", missing: "red", conflict: "yellow" } as Record<string, string>)[ds] ?? "gray" };
  }
  if (n.type === "decision") return { cls: `decision ${n.status !== "done" && n.conditional ? "conditional" : ""}`, dot: "purple" };
  if (n.type === "mdt") return { cls: "mdt", dot: n.status === "done" ? "green" : "teal" };
  if (n.status === "done") return { cls: "proc-done", dot: "green" };
  if (n.status === "available") return { cls: "proc-todo", dot: "blue" };
  return { cls: n.conditional ? "conditional" : n.type === "end" ? "end" : "", dot: "gray" };
}

/** Icon + type label shown in a step's header. */
export function nodeKind(n: PathwayNode): { icon: string; key: string } {
  if (n.type === "start") return { icon: "bolt", key: "fk.start" };
  if (n.type === "end") return { icon: "flag", key: "fk.end" };
  if (n.type === "decision") return { icon: "split", key: "fk.decision" };
  if (n.type === "mdt") return { icon: "users", key: "fk.mdt" };
  if (n.type === "feedback") return { icon: "send", key: "fk.feedback" };
  if (n.type === "handover") return { icon: "arrow", key: "fk.handover" };
  if (n.type === "treatment") return { icon: "pointer", key: "fk.treatment" };
  if (n.completion === "evidence") return { icon: "file", key: "fk.evidence" };
  return { icon: "checkSquare", key: "fk.step" };
}

function FlowNode({ data }: NodeProps<Node<Data>>) {
  const { pick, t } = useApp();
  const n = data.node;
  const { cls, dot } = nodeClass(n, data.plain);
  const kind = nodeKind(n);
  const label = pick(n.label, n.label_en);
  const ring = `${data.selected ? "sel" : ""} ${data.mark ?? ""}`;
  if (n.type === "treatment") {
    return (
      <div className={`fnode ${cls} ${ring}`} title={label}>
        <Handle type="target" position={Position.Top} />
        <Icon name={n.status === "done" ? "check" : kind.icon} />
        <div className="lbl">{label}</div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }
  // status in the header, one short line (date, choice, due) under the label
  let status = "", sub = "";
  if (!data.plain) {
    if (n.doc_status === "waived") status = t("doc.waived");
    else if (n.status === "skipped") status = t("doc.skipped");
    else if (n.completion === "evidence" && n.doc_status) status = t(`doc.${n.doc_status}`);
    else if (n.status === "done") status = t("step.done");
    else if (n.status === "available") status = t("step.todo");
    if (n.completion === "evidence" && n.doc_status === "have" && n.evidence?.[0]) sub = fmtDate(n.evidence[0].date);
    else if (n.type === "decision" && n.detail?.keys?.length) {
      sub = n.detail.keys.map((k) => { const b = n.branches?.find((x) => x.key === k); return pick(b?.label, b?.label_en); }).join(", ");
    } else if (n.status === "done" && n.done_on) sub = fmtDate(n.done_on);
    else if (n.status === "available" && n.due_on) sub = `${t("due")} ${fmtDate(n.due_on)}`;
  } else if (n.blocking === false) status = t("pw.optional");
  return (
    <div className={`fnode ${cls} ${ring}`} title={label}>
      <Handle type="target" position={Position.Top} />
      <div className="fhead">
        <span className="kic"><Icon name={!data.plain && n.status === "done" ? "check" : kind.icon} /></span>
        {t(kind.key)}
        {status && <span className="fst">{dot && <span className={`dot ${dot}`} style={{ width: 6, height: 6 }} />}{status}</span>}
      </div>
      <div className="fbody">
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
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 54, marginx: 16, marginy: 16 });
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
    ? [["orange", t("pw.evidence")], ["purple", t("kind.decision")], ["teal", "MDT"]]
    : [["green", t("doc.have")], ["red", t("doc.missing")], ["yellow", t("doc.conflict")], ["blue", t("step.todo")], ["purple", t("kind.decision")]];
  return <div className="legend">{items.map(([c, l]) => <span key={l}><span className={`dot ${c}`} />{l}</span>)}</div>;
}

export function PathwayFlow({
  graph, plain = false, marks, selectedId, onSelect, editable, onConnect, onDeleteEdge, onDropKind, height = 680, framed = true,
}: {
  graph: PathwayGraph; plain?: boolean;
  marks?: Record<string, "added" | "changed">;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  editable?: boolean;
  onConnect?: (c: Connection) => void;
  onDeleteEdge?: (source: string, target: string) => void;
  onDropKind?: (kind: string) => void;
  height?: number;
  framed?: boolean;
}) {
  const { pick } = useApp();
  const [box, cw] = useWidth<HTMLDivElement>();
  const pos = useMemo(() => layout(graph), [graph]);
  // Size the canvas to the graph at the zoom that fits its width: the whole pathway is visible and nothing is cropped.
  // Very wide graphs stop at MIN_ZOOM so labels stay readable; the rest is reached by panning.
  const [graphW, graphH] = useMemo(() => {
    const ps = Object.values(pos);
    return ps.length ? [Math.max(...ps.map((p) => p.x)) + W + 32, Math.max(...ps.map((p) => p.y)) + H + 32] : [W, H];
  }, [pos]);
  const zoom = cw ? Math.min(1, Math.max(MIN_ZOOM, (cw - 16) / graphW)) : 1;
  const h = Math.min(Math.max(Math.round(graphH * zoom) + 24, Math.min(height, 420)), 1600);
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
    const color = chosen ? "var(--accent)" : done ? "var(--faint)" : "var(--line-strong)";
    const b = e.branch ? src?.branches?.find((x) => x.key === e.branch) : undefined;
    // treatment boxes already carry the option name – only label the other branches (e.g. lung route)
    const branchLabel = dst?.type === "treatment" ? undefined : b ? pick(b.label, b.label_en) : e.label;
    return {
      id: `${e.source}->${e.target}`, source: e.source, target: e.target, type: "smoothstep",
      pathOptions: { borderRadius: 14 },
      label: branchLabel || undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
      animated: !plain && dst?.status === "available",
      style: { stroke: color, strokeWidth: chosen ? 2 : 1.5, strokeDasharray: skipped ? "4 4" : undefined, opacity: skipped ? 0.5 : 1 },
      labelStyle: { fontSize: 12, fill: "var(--muted)", fontWeight: 550 },
      labelBgStyle: { fill: "var(--bg)", stroke: "var(--line-strong)", strokeWidth: 1 },
      labelBgPadding: [9, 4] as [number, number], labelBgBorderRadius: 10,
    };
  });
  return (
    <div className="flow" ref={box} style={{ height: h, ...(framed ? {} : { border: "none", borderRadius: 0, boxShadow: "none" }) }}
      onDragOver={onDropKind ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } : undefined}
      onDrop={onDropKind ? (e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData("application/onkomost-node") || e.dataTransfer.getData("text/plain");
        if (kind) onDropKind(kind);
      } : undefined}>
      {cw > 0 && <ReactFlow key={`${Math.round(cw / 24)}-${graph.nodes.length}`}
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.03, minZoom: MIN_ZOOM, maxZoom: 1 }} minZoom={0.2} maxZoom={1.6}
        nodesConnectable={!!editable} onConnect={onConnect}
        onNodeClick={(_, n) => onSelect?.(n.id)} onPaneClick={() => onSelect?.(null)}
        onEdgeDoubleClick={editable ? (_, e) => onDeleteEdge?.(e.source, e.target) : undefined}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--line-strong)" />
        <Controls showInteractive={false} position="top-right" orientation="horizontal" />
      </ReactFlow>}
    </div>
  );
}
