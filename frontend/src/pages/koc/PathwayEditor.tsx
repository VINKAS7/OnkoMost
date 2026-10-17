import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { Icon } from "../../components/Icon";
import { nodeKind, PathwayFlow } from "../../components/PathwayFlow";
import { FormatPicker, newRequirement, Requirements } from "../../components/Requirements";
import { AutoTextarea, Callout, Spinner, Tag } from "../../components/ui";
import { useAction, useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { PathwayGraph, PathwayNode, PathwayVersion } from "../../types";

const ROLES = ["coordinator", "koc_doctor", "gp", "endoscopy", "pathology", "radiology", "mdt", "k2_coordinator", "external"];
const PALETTE: { kind: string; icon: string; key: string }[] = [
  { kind: "start", icon: "bolt", key: "fk.start" },
  { kind: "document", icon: "file", key: "fk.evidence" },
  { kind: "step", icon: "checkSquare", key: "fk.step" },
  { kind: "decision", icon: "split", key: "fk.decision" },
  { kind: "mdt", icon: "users", key: "fk.mdt" },
  { kind: "treatment", icon: "pointer", key: "fk.treatment" },
  { kind: "handover", icon: "arrow", key: "fk.handover" },
  { kind: "feedback", icon: "send", key: "fk.feedback" },
  { kind: "end", icon: "flag", key: "fk.end" },
];

function makeNode(kind: string): PathwayNode {
  const id = `${kind}_${Date.now().toString(36)}`;
  const base: PathwayNode = { id, type: "step", label: "Nový krok", label_en: "New step", phase: "diagnostics",
    owner_role: "coordinator", sla_days: 7, blocking: true, description: "", description_en: "", accepted_formats: [] };
  if (kind === "start") return { ...base, type: "start", label: "Začátek", label_en: "Start", completion: "auto", phase: "intake", owner_role: "gp", sla_days: 0 };
  if (kind === "document") return { ...base, type: "step", label: "Dokument", label_en: "Document", completion: "evidence", requires: [{ kind: "described" }], accepted_formats: ["pdf", "docx"] };
  if (kind === "decision") return { ...base, type: "decision", label: "Rozhodnutí", label_en: "Decision", completion: "branch",
    branches: [{ key: "yes", label: "Ano", label_en: "Yes" }, { key: "no", label: "Ne", label_en: "No" }] };
  if (kind === "mdt") return { ...base, type: "mdt", label: "MDT", label_en: "MDT", completion: "manual", action: "Hotovo" };
  if (kind === "treatment") return { ...base, type: "treatment", label: "Léčba", label_en: "Treatment", completion: "branch", phase: "treatment" };
  if (kind === "handover") return { ...base, type: "handover", label: "Předání", label_en: "Handover", completion: "manual", action: "Předat" };
  if (kind === "feedback") return { ...base, type: "feedback", label: "Výsledek", label_en: "Result", completion: "manual", action: "Odeslat", phase: "after_mdt" };
  if (kind === "end") return { ...base, type: "end", label: "Konec", label_en: "End", completion: "auto", phase: "after_mdt" };
  return { ...base, completion: "manual", action: "Hotovo" };
}

export default function PathwayEditor() {
  const { id } = useParams();
  const { kocId, t, pick, health, toast } = useApp();
  const { data: v } = useFetch<PathwayVersion>(`/api/pathway-versions/${id}`);
  const [g, setG] = useState<PathwayGraph | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [valid, setValid] = useState<{ valid: boolean; error?: string }>({ valid: true });
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [deadline, setDeadline] = useState("");
  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const { run, busy } = useAction();
  const nav = useNavigate();
  const llmOn = health?.llm !== false;

  useEffect(() => { if (v && !g) setG(structuredClone(v.graph)); }, [v, g]);
  useEffect(() => {
    if (!g) return;
    const timer = setTimeout(() => api.post<{ valid: boolean; error?: string }>("/api/pathway-versions/validate", g).then(setValid), 300);
    return () => clearTimeout(timer);
  }, [g]);

  if (!v || !g) return <div className="page muted">{t("common.loading")}</div>;
  const node = g.nodes.find((n) => n.id === sel);
  const editable = v.status === "draft" && v.created_by_koc_id === kocId;
  const upd = (patch: Partial<PathwayNode>) => setG({ ...g, nodes: g.nodes.map((n) => (n.id === sel ? { ...n, ...patch } : n)) });
  const save = () => run(() => api.put(`/api/pathway-versions/${v.id}`, { koc_id: kocId, graph: g }), "✓");
  const addKind = (kind: string) => {
    const n = makeNode(kind);
    const edges = sel && !g.edges.some((e) => e.source === sel && e.target === n.id)
      ? [...g.edges, { source: sel, target: n.id }] : g.edges;
    setG({ nodes: [...g.nodes, n], edges });
    setSel(n.id);
  };
  const remove = (nid: string) => {
    setG({ nodes: g.nodes.filter((n) => n.id !== nid), edges: g.edges.filter((e) => e.source !== nid && e.target !== nid) });
    setSel(null);
  };
  const kind = node ? nodeKind(node) : null;
  const generate = async () => {
    const prompt = brief.trim();
    if (prompt.length < 8) { toast(t("ed.ai.empty"), true); return; }
    setGenerating(true);
    setAiError("");
    try {
      const r = await api.post<{ graph: PathwayGraph }>("/api/pathway-versions/generate", { prompt, current: g });
      setG(r.graph);
      setSel(null);
      toast(t("ed.ai.done"));
    } catch (e) {
      const msg = (e as Error).message;
      setAiError(msg);
      toast(msg, true);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page wide" style={{ gap: 18 }}>
      <div className="window">
        <div className="window-bar">
          <div className="crumbs">
            <Link to="/koc/pathways">{t("nav.pathways")}</Link>
            <Icon name="chevron" />
            <span>{pick(v.pathway, v.pathway_en)}</span>
            <span className="muted" style={{ fontWeight: 500 }}>v{v.version}</span>
          </div>
          <Tag color={valid.valid ? "green" : "red"} title={valid.error}>
            <span className={`dot ${valid.valid ? "green" : "red"}`} style={{ width: 6, height: 6 }} />
            {valid.valid ? t("ed.valid") : t("ed.invalid")}
          </Tag>
          {!editable && <Tag color="yellow">{v.status} · {t("ed.readonly")}</Tag>}
          {editable && <button className="sm primary right" disabled={!valid.valid || busy} onClick={save}>{t("ed.save")}</button>}
        </div>
        {!valid.valid && valid.error && <div style={{ padding: "10px 18px 0" }}><Callout color="red">{valid.error}</Callout></div>}
        <div className="window-split editor">
          {editable && (
            <aside className="palette">
              <div className="section-title">{t("ed.palette")}</div>
              <div className="xs muted" style={{ marginBottom: 8 }}>{t("ed.paletteHint")}</div>
              {PALETTE.map((p) => (
                <div key={p.kind} className="palette-item" draggable
                  onDragStart={(e) => { e.dataTransfer.setData("application/onkomost-node", p.kind); e.dataTransfer.setData("text/plain", p.kind); e.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => addKind(p.kind)}>
                  <span className="kic"><Icon name={p.icon} /></span>
                  <span>{t(p.key)}</span>
                </div>
              ))}
            </aside>
          )}
          <div className="flow-host">
            <PathwayFlow graph={g} plain framed={false} selectedId={sel} onSelect={setSel} editable={editable} height={780}
              onConnect={(c) => { if (c.source && c.target && c.source !== c.target && !g.edges.some((e) => e.source === c.source && e.target === c.target)) setG({ ...g, edges: [...g.edges, { source: c.source, target: c.target }] }); }}
              onDeleteEdge={(s, tt) => setG({ ...g, edges: g.edges.filter((e) => !(e.source === s && e.target === tt)) })}
              onDropKind={editable ? addKind : undefined} />
            {editable && (
              <div className="ai-bar">
                <div className="ai-bar-row">
                  <AutoTextarea
                    value={brief}
                    disabled={generating}
                    placeholder={t("ed.ai.placeholder")}
                    onChange={(e) => setBrief(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); } }}
                  />
                  <button className="primary sm ai-go" disabled={generating || busy || !llmOn} onClick={generate}>
                    {generating ? <Spinner /> : <Icon name="spark" />}
                    {t("ed.ai.go")}
                  </button>
                </div>
                <div className="xs muted" style={aiError ? { color: "var(--red)" } : undefined}>{aiError || (llmOn ? t("ed.ai.hint") : t("ed.ai.offline"))}</div>
              </div>
            )}
            {generating && (
              <div className="ai-busy">
                <div style={{ display: "grid", justifyItems: "center", gap: 10 }}>
                  <Spinner />
                  <div>{t("ed.ai.working")}</div>
                </div>
              </div>
            )}
          </div>
          <aside className="window-side">
            <div className="window-panel">
              {node && kind ? (
                <>
                  <div className="panel-head">
                    <span className="kic"><Icon name={kind.icon} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="xs muted">{t(kind.key)}</div>
                      <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pick(node.label, node.label_en)}</h3>
                    </div>
                    {editable && <span className="muted" title={t("ed.title")}><Icon name="pencil" /></span>}
                    <button className="ghost icon" aria-label="close" onClick={() => setSel(null)}><Icon name="x" /></button>
                  </div>
                  <div className="panel-body">
                    <div className="section-title" style={{ marginBottom: -6 }}>{t("ed.labels")}</div>
                    <label className="field">CZ<input disabled={!editable} value={node.label} onChange={(e) => upd({ label: e.target.value })} /></label>
                    <label className="field">EN<input disabled={!editable} value={node.label_en ?? ""} onChange={(e) => upd({ label_en: e.target.value })} /></label>
                    <label className="field">{t("ed.description")} (CZ)
                      <AutoTextarea disabled={!editable} value={node.description ?? ""} onChange={(e) => upd({ description: e.target.value })} style={{ minHeight: 72 }} />
                    </label>
                    <label className="field">{t("ed.description")} (EN)
                      <AutoTextarea disabled={!editable} value={node.description_en ?? ""} onChange={(e) => upd({ description_en: e.target.value })} style={{ minHeight: 72 }} />
                    </label>
                    {node.completion === "evidence" && (
                      <>
                        <div className="section-title" style={{ marginBottom: -6 }}>{t("ed.formats")}</div>
                        <FormatPicker value={node.accepted_formats ?? []} onChange={editable ? (accepted_formats) => upd({ accepted_formats }) : undefined} />
                        <div className="section-title" style={{ marginBottom: -6, marginTop: 4 }}>{t("ed.when")}</div>
                        <Requirements value={node.requires ?? []} onChange={editable ? (r) => upd({ requires: r }) : undefined} />
                      </>
                    )}
                    <div className="row" style={{ alignItems: "flex-end" }}>
                      <label className="field grow">{t("pw.owner")}<select disabled={!editable} value={node.owner_role} onChange={(e) => upd({ owner_role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
                      <label className="field" style={{ width: 96 }}>SLA<input type="number" disabled={!editable} value={node.sla_days ?? 0} onChange={(e) => upd({ sla_days: Number(e.target.value) })} /></label>
                    </div>
                    <div className="row" style={{ alignItems: "flex-end" }}>
                      <label className="field grow">{t("pw.doneOn")}<select disabled={!editable || node.type === "decision"} value={node.completion} onChange={(e) => upd({ completion: e.target.value, requires: e.target.value === "evidence" && !node.requires?.length ? [{ kind: "described" }] : node.requires })}>
                        <option value="manual">manual</option><option value="evidence">evidence (document)</option><option value="branch">branch</option><option value="auto">auto</option></select></label>
                      <label className="row small" style={{ minHeight: 38, gap: 8 }}>
                        <input type="checkbox" disabled={!editable} checked={node.blocking !== false} onChange={(e) => upd({ blocking: e.target.checked })} style={{ minHeight: 0, width: "auto" }} />blocking
                      </label>
                    </div>
                  </div>
                  {editable && (
                    <div className="panel-foot">
                      {node.completion === "evidence" && (
                        <button className="sm" onClick={() => upd({ requires: [...(node.requires ?? []), newRequirement()] })}><Icon name="plus" />{t("cb.add")}</button>
                      )}
                      <button className="sm ghost danger" onClick={() => remove(node.id)}>{t("ed.delete")}</button>
                      <button className="primary right" disabled={!valid.valid || busy} onClick={save}>{t("ed.save")}</button>
                    </div>
                  )}
                </>
              ) : (
                <div className="panel-empty">
                  <Icon name="pointer" />
                  <div>{t("ed.pick")}</div>
                  <div className="xs">{t("ed.sub")}</div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
      {editable && (
        <section className="card">
          <div className="card-head"><span className="kic-lg"><Icon name="vote" /></span><h3>{t("ed.submit")}</h3></div>
          <div className="card-body col" style={{ gap: 14 }}>
            <div className="xs muted">{t("pr.sub")}</div>
            <div className="row wrap" style={{ alignItems: "flex-end" }}>
              <label className="field grow">{t("ed.ptitle")}<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="field" style={{ width: 200 }}>{t("ed.deadline")}<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
            </div>
            <label className="field">{t("ed.rationale")}<AutoTextarea value={rationale} onChange={(e) => setRationale(e.target.value)} style={{ minHeight: 84 }} /></label>
            <div>
              <button className="primary" disabled={!valid.valid || !title || !rationale || !deadline || busy}
                onClick={() => run(async () => { await api.put(`/api/pathway-versions/${v.id}`, { koc_id: kocId, graph: g }); return api.post<{ proposal_id: number }>("/api/proposals", { draft_version_id: v.id, title, rationale, deadline, koc_id: kocId }); }, "✓", (r) => nav(`/koc/proposals/${r.proposal_id}`))}>
                <Icon name="send" />{t("ed.submitBtn")}</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
