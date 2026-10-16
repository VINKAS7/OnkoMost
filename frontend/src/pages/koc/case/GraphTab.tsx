import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { fmtDate } from "../../../api";
import { useApp } from "../../../ctx";
import { useFetch } from "../../../hooks";
import type { CaseDetail, GraphView } from "../../../types";

const KINDS: Record<string, { en: string; cs: string; color: string }> = {
  patient: { en: "Patient", cs: "Pacient", color: "var(--text)" }, document: { en: "Document", cs: "Dokument", color: "#9b9a97" },
  facility: { en: "Facility", cs: "Pracoviště", color: "#c7c6c3" }, diagnosis: { en: "Diagnosis", cs: "Diagnóza", color: "#d44c47" },
  condition: { en: "Comorbidity", cs: "Komorbidita", color: "#d9730d" }, medication: { en: "Medication", cs: "Lék", color: "#448361" },
  symptom: { en: "Symptom", cs: "Symptom", color: "#cb912f" }, exam: { en: "Exam", cs: "Vyšetření", color: "#337ea9" },
  lab: { en: "Lab value", cs: "Laboratoř", color: "#6f7fd1" }, measurement: { en: "Measurement", cs: "Měření", color: "#4ba3b8" },
  note: { en: "Note", cs: "Poznámka", color: "#9065b0" }, precaution: { en: "Precaution", cs: "Opatření", color: "#c14c8a" },
  mentioned_exam: { en: "Mentioned exam", cs: "Zmíněné vyšetření", color: "#9b9a97" },
  contact_person: { en: "Contact", cs: "Kontakt", color: "#7a8f4f" }, referring_doctor: { en: "Referring doctor", cs: "Referující lékař", color: "#7a8f4f" },
  allergy: { en: "Allergy", cs: "Alergie", color: "#d9730d" }, epikriza: { en: "Epikríza", cs: "Epikríza", color: "#9b9a97" },
  mdt_question: { en: "MDT question", cs: "Otázka na MDT", color: "#9b9a97" },
};
const DEFAULT_OFF = new Set(["lab", "facility", "mentioned_exam", "symptom", "note", "epikriza", "mdt_question", "referring_doctor"]);
const SIZE: Record<string, number> = { patient: 30, document: 14, diagnosis: 16 };
const ALWAYS_LABEL = new Set(["patient", "diagnosis", "document", "exam", "condition", "medication", "precaution", "allergy", "contact_person"]);

type GData = { label: string; kind: string; size: number; selected: boolean; dim: boolean; showLabel: boolean };

function GNode({ data }: NodeProps<Node<GData>>) {
  const color = KINDS[data.kind]?.color ?? "#9b9a97";
  const square = data.kind === "document" || data.kind === "facility";
  const center = { top: "50%", left: "50%", opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: "none" };
  return (
    <div style={{ width: data.size, height: data.size, position: "relative", opacity: data.dim ? 0.25 : 1 }} title={data.label}>
      <Handle type="target" position={Position.Top} style={center} />
      <div style={{ width: "100%", height: "100%", borderRadius: square ? 3 : "50%", background: data.kind === "document" ? "var(--bg)" : color,
        border: `2px solid ${color}`, boxShadow: data.selected ? `0 0 0 4px ${color}33` : undefined }} />
      {data.showLabel && (
        <div style={{ position: "absolute", left: data.size + 5, top: "50%", transform: "translateY(-50%)", whiteSpace: "nowrap",
          fontSize: data.kind === "patient" ? 13 : 10.5, fontWeight: data.kind === "patient" || data.kind === "diagnosis" ? 650 : 450,
          color: "var(--text)", background: "var(--bg)", padding: "0 2px", borderRadius: 3, pointerEvents: "none" }}>{data.label}</div>
      )}
      <Handle type="source" position={Position.Top} style={center} />
    </div>
  );
}
const nodeTypes = { g: GNode };

type SimNode = SimulationNodeDatum & { id: string; kind: string };

function shortLabel(n: GraphView["nodes"][number]): string {
  if (n.kind === "document") {
    const title = String(n.label ?? "").replace(/^(Výsledek vyšetření|Výsledky laboratorního vyšetření|Ambulantní zpráva|Protokol o výkonu)\s*[–-]?\s*/, "") || String(n.label ?? "");
    return `${title.slice(0, 28)}${n.props.date ? ` · ${fmtDate(String(n.props.date))}` : ""}`;
  }
  const l = String(n.label ?? "");
  return l.length > 30 ? `${l.slice(0, 28)}…` : l;
}

export default function GraphTab({ c }: { c: CaseDetail }) {
  const { t, lang } = useApp();
  const [cutoff, setCutoff] = useState<string>(c.mdt_date ?? "");
  const [off, setOff] = useState<Set<string>>(DEFAULT_OFF);
  const [sel, setSel] = useState<string | null>(null);
  const { data } = useFetch<GraphView>(`/api/cases/${c.id}/graph${cutoff ? `?cutoff=${cutoff}` : ""}`);

  // 1) force layout – recomputed only when the data or the visible kinds change
  const layout = useMemo(() => {
    if (!data) return null;
    const visible = data.nodes.filter((n) => !off.has(n.kind));
    const ids = new Set(visible.map((n) => n.id));
    const links = data.edges.filter((e) => e.label !== "ABOUT" && ids.has(e.source) && ids.has(e.target));
    const simNodes: SimNode[] = visible.map((n) => ({ id: n.id, kind: n.kind, ...(n.kind === "patient" ? { fx: 0, fy: 0 } : {}) }));
    const simLinks: (SimulationLinkDatum<SimNode> & { label: string })[] = links.map((e) => ({ source: e.source, target: e.target, label: e.label }));
    const sim = forceSimulation(simNodes)
      .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode> & { label: string }>(simLinks).id((d) => d.id)
        .distance((l) => (l.label === "HAS" ? 140 : l.label === "STATED_IN" ? 90 : 40)).strength(0.45))
      .force("charge", forceManyBody().strength(-520))
      .force("collide", forceCollide<SimNode>().radius((d) => (d.kind === "patient" ? 70 : 40)).strength(0.9))
      .force("center", forceCenter(0, 0))
      .stop();
    for (let i = 0; i < 400; i++) sim.tick();
    const pos = Object.fromEntries(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    return { visible, links, pos, key: `${visible.length}-${links.length}-${cutoff}` };
  }, [data, off, cutoff]);

  // 2) render – highlight the selected node and its neighbours
  const { nodes, edges, counts } = useMemo(() => {
    const counts: Record<string, number> = {};
    data?.nodes.forEach((n) => { counts[n.kind] = (counts[n.kind] ?? 0) + 1; });
    if (!layout) return { nodes: [] as Node<GData>[], edges: [] as Edge[], counts };
    const neigh = new Set<string>(sel ? [sel] : []);
    layout.links.forEach((e) => { if (e.source === sel) neigh.add(e.target); if (e.target === sel) neigh.add(e.source); });
    const nodes: Node<GData>[] = layout.visible.map((n) => {
      const size = SIZE[n.kind] ?? 11;
      const p = layout.pos[n.id];
      return {
        id: n.id, type: "g", position: { x: p.x - size / 2, y: p.y - size / 2 }, draggable: false,
        data: { label: shortLabel(n), kind: n.kind, size, selected: n.id === sel, dim: !!sel && !neigh.has(n.id),
                showLabel: ALWAYS_LABEL.has(n.kind) || neigh.has(n.id) },
      };
    });
    const edges: Edge[] = layout.links.map((e, i) => {
      const on = !!sel && (e.source === sel || e.target === sel);
      return { id: `e${i}`, source: e.source, target: e.target, type: "straight",
               style: { stroke: on ? "var(--text)" : "var(--line-strong)", strokeWidth: on ? 1.6 : 1, opacity: sel && !on ? 0.25 : 1 } };
    });
    return { nodes, edges, counts };
  }, [layout, sel, data]);

  const node = data?.nodes.find((n) => n.id === sel);
  const kindLabel = (k: string) => (lang === "en" ? KINDS[k]?.en : KINDS[k]?.cs) ?? k;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="col" style={{ gap: 8 }}>
        <div className="spread wrap">
          <div className="legend">
            {Object.entries(counts).map(([k, n]) => (
              <label key={k} className="row" style={{ gap: 5, cursor: "pointer", opacity: off.has(k) ? 0.45 : 1 }}>
                <input type="checkbox" checked={!off.has(k)} style={{ minHeight: 0 }}
                  onChange={() => { const s = new Set(off); if (s.has(k)) s.delete(k); else s.add(k); setOff(s); }} />
                <span className="dot" style={{ background: KINDS[k]?.color }} />{kindLabel(k)} {n}
              </label>
            ))}
          </div>
          <label className="row small muted">{t("g.upto")}
            <input type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
            {cutoff && <button className="sm ghost" onClick={() => setCutoff("")}>{t("g.all")}</button>}
          </label>
        </div>
        <div className="flow" style={{ height: 780 }}>
          <ReactFlow key={layout?.key ?? "empty"} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.05, minZoom: 0.62 }} minZoom={0.15}
            onNodeClick={(_, n) => setSel(n.id === sel ? null : n.id)} onPaneClick={() => setSel(null)} nodesConnectable={false}
            proOptions={{ hideAttribution: true }}>
            <Background gap={24} size={1} color="var(--line)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="xs muted">{t("g.hint")} {t("g.click")}</div>
      </div>
      <div style={{ position: "relative" }}>
        {node ? (
          <div className="block" style={{ position: "absolute", right: 12, bottom: 60, width: 340, maxHeight: 520, overflow: "auto", boxShadow: "0 8px 24px rgba(15,15,15,0.12)" }}>
            <div className="spread"><div className="section-title" style={{ color: KINDS[node.kind]?.color, margin: 0 }}>{kindLabel(node.kind)}</div><button className="sm ghost" onClick={() => setSel(null)}>×</button></div>
            <b>{node.label}</b>
            <table style={{ marginTop: 8 }} className="small"><tbody>
              {Object.entries(node.props).filter(([k, v]) => v !== null && v !== "" && !["id", "patient_uuid", "kind", "icd10_from_name", "uid", "sha256", "sqlite_id"].includes(k)).map(([k, v]) => (
                <tr key={k}><td className="muted" style={{ width: 90 }}>{k}</td><td style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : String(v).slice(0, 500)}</td></tr>
              ))}
            </tbody></table>
            {node.kind === "document" && <a className="btn sm" style={{ marginTop: 8 }} href={`/api/documents/${node.props.sqlite_id}/raw`}>{t("docs.original")}</a>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
