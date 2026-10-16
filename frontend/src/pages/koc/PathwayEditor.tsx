import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { PathwayFlow } from "../../components/PathwayFlow";
import { Callout, PageHead, Tag } from "../../components/ui";
import { useAction, useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { PathwayGraph, PathwayNode, PathwayVersion } from "../../types";

const ROLES = ["coordinator", "koc_doctor", "gp", "endoscopy", "pathology", "radiology", "mdt", "k2_coordinator", "external"];

export default function PathwayEditor() {
  const { id } = useParams();
  const { kocId, t, pick } = useApp();
  const { data: v } = useFetch<PathwayVersion>(`/api/pathway-versions/${id}`);
  const [g, setG] = useState<PathwayGraph | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [valid, setValid] = useState<{ valid: boolean; error?: string }>({ valid: true });
  const [reqText, setReqText] = useState("");
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [deadline, setDeadline] = useState("");
  const [newId, setNewId] = useState("");
  const { run, busy } = useAction();
  const nav = useNavigate();

  useEffect(() => { if (v && !g) setG(structuredClone(v.graph)); }, [v, g]);
  useEffect(() => {
    if (!g) return;
    const timer = setTimeout(() => api.post<{ valid: boolean; error?: string }>("/api/pathway-versions/validate", g).then(setValid), 300);
    return () => clearTimeout(timer);
  }, [g]);
  const node = g?.nodes.find((n) => n.id === sel);
  useEffect(() => { setReqText(node ? JSON.stringify(node.requires ?? []) : ""); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v || !g) return <div className="page muted">{t("common.loading")}</div>;
  const editable = v.status === "draft" && v.created_by_koc_id === kocId;
  const upd = (patch: Partial<PathwayNode>) => setG({ ...g, nodes: g.nodes.map((n) => (n.id === sel ? { ...n, ...patch } : n)) });
  const addNode = () => {
    const nid = newId.trim().replace(/\s+/g, "_").toLowerCase();
    if (!nid || g.nodes.some((n) => n.id === nid)) return;
    const n: PathwayNode = { id: nid, type: "step", label: "Nový krok", label_en: "New step", phase: "diagnostics", owner_role: "coordinator",
      sla_days: 7, completion: "manual", requires: [], blocking: true, action: "Hotovo" };
    setG({ nodes: [...g.nodes, n], edges: sel ? [...g.edges, { source: sel, target: nid }] : g.edges });
    setSel(nid); setNewId("");
  };

  return (
    <div className="page wide">
      <PageHead title={<>{t("ed.title")} · {pick(v.pathway, v.pathway_en)} <span className="muted">v{v.version}</span></>} lead={t("ed.sub")}
        right={<Tag color={valid.valid ? "green" : "red"}>{valid.valid ? t("ed.valid") : `${t("ed.invalid")}: ${valid.error}`}</Tag>} />
      {!editable && <Callout color="yellow">{v.status} – {t("ed.readonly")}</Callout>}
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <PathwayFlow graph={g} plain selectedId={sel} onSelect={setSel} editable={editable} height={820}
          onConnect={(c) => { if (c.source && c.target && c.source !== c.target && !g.edges.some((e) => e.source === c.source && e.target === c.target)) setG({ ...g, edges: [...g.edges, { source: c.source, target: c.target }] }); }}
          onDeleteEdge={(s, tt) => setG({ ...g, edges: g.edges.filter((e) => !(e.source === s && e.target === tt)) })} />
        <div className="col" style={{ gap: 14 }}>
          {editable && (
            <section className="block col">
              <h3>{t("ed.add")}</h3>
              <div className="row"><input placeholder="id, e.g. genetics" value={newId} onChange={(e) => setNewId(e.target.value)} className="grow" />
                <button onClick={addNode} disabled={!newId}>{sel ? t("ed.addAfter") : t("ed.add")}</button></div>
            </section>
          )}
          {node && (
            <section className="block col">
              <div className="spread"><h3>{node.id}</h3>{editable && node.type !== "start" && <button className="sm danger" onClick={() => { setG({ nodes: g.nodes.filter((n) => n.id !== node.id), edges: g.edges.filter((e) => e.source !== node.id && e.target !== node.id) }); setSel(null); }}>{t("ed.delete")}</button>}</div>
              <label className="field">CZ<input disabled={!editable} value={node.label} onChange={(e) => upd({ label: e.target.value })} /></label>
              <label className="field">EN<input disabled={!editable} value={node.label_en ?? ""} onChange={(e) => upd({ label_en: e.target.value })} /></label>
              <div className="row">
                <label className="field grow">{t("pw.owner")}<select disabled={!editable} value={node.owner_role} onChange={(e) => upd({ owner_role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
                <label className="field" style={{ width: 90 }}>SLA<input type="number" disabled={!editable} value={node.sla_days ?? 0} onChange={(e) => upd({ sla_days: Number(e.target.value) })} /></label>
              </div>
              <div className="row">
                <label className="field grow">{t("pw.doneOn")}<select disabled={!editable || node.type === "decision"} value={node.completion} onChange={(e) => upd({ completion: e.target.value })}>
                  <option value="manual">manual</option><option value="evidence">evidence (document)</option><option value="branch">branch</option><option value="auto">auto</option></select></label>
                <label className="field"><span>blocking</span><input type="checkbox" disabled={!editable} checked={node.blocking !== false} onChange={(e) => upd({ blocking: e.target.checked })} style={{ minHeight: 0 }} /></label>
              </div>
              {node.completion === "evidence" && (
                <label className="field">{t("pw.requires")} (JSON)
                  <textarea className="mono" disabled={!editable} value={reqText} onChange={(e) => { setReqText(e.target.value); try { upd({ requires: JSON.parse(e.target.value) }); } catch { /* typing */ } }} />
                </label>
              )}
              <label className="field">·<textarea disabled={!editable} value={node.description ?? ""} onChange={(e) => upd({ description: e.target.value })} /></label>
            </section>
          )}
          {editable && (
            <section className="block col">
              <div><button disabled={!valid.valid || busy} onClick={() => run(() => api.put(`/api/pathway-versions/${v.id}`, { koc_id: kocId, graph: g }), "✓")}>{t("ed.save")}</button></div>
              <h3>{t("ed.submit")}</h3>
              <label className="field">{t("ed.ptitle")}<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="field">{t("ed.rationale")}<textarea value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
              <label className="field">{t("ed.deadline")}<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
              <button className="primary" disabled={!valid.valid || !title || !rationale || !deadline || busy}
                onClick={() => run(async () => { await api.put(`/api/pathway-versions/${v.id}`, { koc_id: kocId, graph: g }); return api.post<{ proposal_id: number }>("/api/proposals", { draft_version_id: v.id, title, rationale, deadline, koc_id: kocId }); }, "✓", (r) => nav(`/koc/proposals/${r.proposal_id}`))}>
                {t("ed.submitBtn")}</button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
