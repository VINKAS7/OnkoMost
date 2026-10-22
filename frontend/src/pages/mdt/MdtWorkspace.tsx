import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate } from "../../api";
import { CtViewer } from "../../components/CtViewer";
import { Icon } from "../../components/Icon";
import { JourneyTimeline } from "../../components/JourneyTimeline";
import { LabTrends } from "../../components/LabTrends";
import { AutoTextarea, DocCounts, Spinner, Status } from "../../components/ui";
import { useAction, useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { AskResult, CaseDetail, MdtImport, MdtReport } from "../../types";
import { age } from "../koc/CasePage";
import BodyMap, { type BodyFilter } from "./BodyMap";

const TREATMENTS = ["active_monitoring", "palliative", "chemotherapy", "radiotherapy", "surgery"];

/** Render "[D12]" citations as links to the original document. */
function Cited({ text }: { text: string }) {
  return <>{text.split(/(\[D\d+\])/g).map((p, i) => {
    const m = p.match(/^\[D(\d+)\]$/);
    return m ? <a key={i} className="cite" href={`/api/documents/${m[1]}/raw`}>D{m[1]}</a> : <Fragment key={i}>{p}</Fragment>;
  })}</>;
}

function AskPanel({ c }: { c: CaseDetail }) {
  const { t, lang, toast } = useApp();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<AskResult[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [log, busy]);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<AskResult>(`/api/cases/${c.id}/ask`, { question, lang });
      setLog((l) => [...l, r]);
      setQ("");
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  const samples = lang === "en"
    ? ["What is the CA 19-9 value?", "Is the tumour touching blood vessels?", "Is the patient on anticoagulants?"]
    : ["Jaká je hodnota CA 19-9?", "Dotýká se nádor cév?", "Užívá pacientka antikoagulancia?"];
  return (
    <section className="col" style={{ gap: 12 }}>
      <div><div className="section-title">{t("mdt.ask")}</div><div className="xs muted">{t("mdt.ask.d")}</div></div>
      {log.map((r, i) => (
        <div key={i} className="col" style={{ gap: 6 }}>
          <div className="msg-q">{r.question}</div>
          <div className="msg-a"><Cited text={r.answer} /></div>
          {r.translation && <div className="small muted" style={{ borderLeft: "2px solid var(--line)", paddingLeft: 10 }}>{r.translation}<div className="xs faint">{t("mdt.translation")}</div></div>}
          {!r.grounded && <div className="xs" style={{ color: "var(--yellow)" }}>{t("mdt.notGrounded")}</div>}
          {!!r.sources.length && (
            <details>
              <summary className="xs muted">{t("mdt.sources")} ({r.sources.length})</summary>
              {r.sources.map((s) => (
                <div key={s.doc_id} className="small" style={{ marginTop: 6 }}>
                  <a href={`/api/documents/${s.doc_id}/raw`}>D{s.doc_id} · {s.title}</a> <span className="muted">· {fmtDate(s.date)}</span>
                  {s.snippets.slice(0, 1).map((x, j) => <div key={j} className="xs muted" style={{ whiteSpace: "pre-wrap", borderLeft: "2px solid var(--line)", paddingLeft: 8, marginTop: 2 }}>{x}</div>)}
                </div>
              ))}
            </details>
          )}
        </div>
      ))}
      {busy && <div className="row small muted"><Spinner /> {t("mdt.ask.thinking")}</div>}
      <div ref={end} />
      {!log.length && !busy && <div className="row wrap">{samples.map((s) => <button key={s} className="sm ghost" style={{ border: "1px solid var(--line)" }} onClick={() => ask(s)}>{s}</button>)}</div>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("mdt.ask.ph")} disabled={busy} />
        <button className="primary" disabled={busy || !q.trim()}>{t("mdt.ask.send")}</button>
      </form>
    </section>
  );
}

/** CT / MRI / PET series of the case (up to the MDT date), one at a time in the viewer. */
function Imaging({ c }: { c: CaseDetail }) {
  const { t } = useApp();
  const series = c.documents.filter((d) => d.doc_type === "image_series" && d.status === "done" && !d.post_mdt);
  const [sel, setSel] = useState<number | null>(null);
  if (!series.length) return null;
  const current = series.find((d) => d.id === sel) ?? series[0];
  return (
    <section className="col" style={{ gap: 8 }}>
      <div className="section-title" style={{ margin: 0 }}>{t("ct.images")}</div>
      {series.length > 1 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {series.map((d) => <button key={d.id} className={`sm ${d.id === current.id ? "primary" : ""}`} onClick={() => setSel(d.id)}>{d.title}</button>)}
        </div>
      )}
      <div className="small"><b>{current.title}</b> <span className="muted">· D{current.id} · {fmtDate(current.doc_date)}</span></div>
      <CtViewer docId={current.id} />
    </section>
  );
}

/** Once the case is ready for the MDT: the one-sheet summary as an editable Word file, or onto the clipboard with its
 *  tables and charts (pastes into Word, e-mail or Teams) – to discuss and decide on. */
function SummaryActions({ c }: { c: CaseDetail }) {
  const { t, lang, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const ready = c.state_index >= c.states.findIndex((s) => s.key === "ready_for_mdt");
  if (!ready) return <span className="xs muted">{t("sum.notReady")}</span>;
  const copy = async () => {
    setBusy(true);
    try {
      const r = await api.get<{ title: string; html: string; text: string }>(`/api/cases/${c.id}/mdt/summary?lang=${lang}`);
      try {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([r.html], { type: "text/html" }), "text/plain": new Blob([r.text], { type: "text/plain" }),
        })]);
      } catch {
        await navigator.clipboard.writeText(r.text); // a browser without rich clipboard still gets the text
      }
      toast(t("sum.copied"));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      <a className="btn sm primary" href={`/api/cases/${c.id}/mdt/summary.docx?lang=${lang}`} title={t("sum.download.d")}>
        <Icon name="download" />{t("sum.download")}
      </a>
      <button className="sm" disabled={busy} onClick={copy} title={t("sum.copy.d")}>
        {busy ? <Spinner /> : <Icon name="copy" />}{t("sum.copy")}
      </button>
    </div>
  );
}

function DecisionPanel({ c, brief, reload }: { c: CaseDetail; brief: MdtReport | null; reload: () => void }) {
  const { t } = useApp();
  const { run, busy } = useAction();
  const mc = c.mdt_conclusion;
  const [sel, setSel] = useState<string[]>(c.treatments);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [conclusion, setConclusion] = useState(mc?.conclusion ?? "");
  const [recs, setRecs] = useState((mc?.recommendations ?? []).join("\n"));
  const [diagnosis, setDiagnosis] = useState(mc?.diagnosis ?? "");
  const [docId, setDocId] = useState<number | null>(mc?.document_id ?? null);
  const members = brief?.members ?? [];
  const [present, setPresent] = useState<string[]>(mc?.members ?? []);
  useEffect(() => { if (!mc && members.length && !present.length) setPresent(members.map((m) => m.name)); }, [members.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const decided = !!mc && c.treatments.length > 0;

  const importDocx = (f?: File) => {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    run(() => api.post<MdtImport>(`/api/cases/${c.id}/mdt/import`, fd), "✓", (r) => {
      setConclusion(r.conclusion); setRecs(r.recommendations.join("\n")); setDiagnosis(r.diagnosis); setDocId(r.document_id);
      setSuggested(r.suggested_treatments); setSel(r.suggested_treatments);
      if (r.members.length) setPresent(r.members);
    });
  };
  const record = () => run(() => api.post(`/api/cases/${c.id}/mdt/decision`, {
    treatments: sel, conclusion, recommendations: recs.split("\n"), diagnosis, members: present, document_id: docId, by: present[0] ?? "MDT",
  }), t("mdt.recorded"), reload);

  return (
    <section className="col" style={{ gap: 14 }}>
      <div className="spread wrap">
        <div className="section-title" style={{ margin: 0 }}>{t("mdt.decide")}</div>
        {decided ? <Status color="green">{t("mdt.recorded")} · {fmtDate(mc?.recorded_on)}</Status> :
          <label className="linkbtn">{t("mdt.import")}<input type="file" accept=".docx" hidden onChange={(e) => importDocx(e.target.files?.[0])} /></label>}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {TREATMENTS.map((k) => (
          <button key={k} type="button" className={sel.includes(k) ? "primary" : ""} disabled={decided} aria-pressed={sel.includes(k)}
            onClick={() => setSel(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k])}
            title={suggested.includes(k) ? t("mdt.suggested") : undefined}>
            {t(`tr.${k}`)}{suggested.includes(k) ? " *" : ""}
          </button>
        ))}
      </div>
      {suggested.length > 0 && !decided && <div className="xs muted">* {t("mdt.suggested")}</div>}
      <label className="field">{t("mdt.diagnosis")}<AutoTextarea value={diagnosis} disabled={decided} onChange={(e) => setDiagnosis(e.target.value)} style={{ minHeight: 52 }} /></label>
      <label className="field">{t("mdt.conclusion")}<AutoTextarea value={conclusion} disabled={decided} onChange={(e) => setConclusion(e.target.value)} style={{ minHeight: 100 }} /></label>
      <label className="field">{t("mdt.recs")}<AutoTextarea value={recs} disabled={decided} onChange={(e) => setRecs(e.target.value)} style={{ minHeight: 100 }} /></label>
      {!!members.length && (
        <details>
          <summary className="small muted">{t("mdt.members")} ({present.length}/{members.length})</summary>
          <div className="col" style={{ gap: 4, marginTop: 6 }}>{members.map((m) => (
            <label key={m.name} className="row small" style={{ gap: 6 }}>
              <input type="checkbox" disabled={decided} checked={present.includes(m.name)} style={{ minHeight: 0 }}
                onChange={() => setPresent(present.includes(m.name) ? present.filter((x) => x !== m.name) : [...present, m.name])} />
              {m.name} <span className="faint">{m.role}</span>
            </label>
          ))}</div>
        </details>
      )}
      {!decided && <div><button className="primary" disabled={!sel.length || !conclusion.trim() || busy} onClick={record}>{t("mdt.record")}</button></div>}
    </section>
  );
}

export default function MdtWorkspace() {
  const { id } = useParams();
  const { t, pick } = useApp();
  const { data: c, reload } = useFetch<CaseDetail>(`/api/cases/${id}`);
  const { data: brief } = useFetch<MdtReport>(`/api/cases/${id}/mdt/brief`);
  const [filter, setFilter] = useState<BodyFilter>(null);
  const [hoverDoc, setHoverDoc] = useState<number | null>(null);
  if (!c) return <div className="page muted">{t("common.loading")}</div>;
  const conflicts = c.findings.filter((f) => f.kind === "mismatch" && !f.reviewed);
  const missing = c.pathway_graph.nodes.filter((n) => n.doc_status === "missing" && n.blocking !== false);
  const waived = c.pathway_graph.nodes.filter((n) => n.doc_status === "waived");  // the MDT must see what was skipped
  const shown = (docId: number | null) => !filter || (docId != null && filter.docIds.includes(docId));

  return (
    <div className="page wide" style={{ gap: 18 }}>
      <div className="small"><Link to="/mdt" className="muted">{t("mdt.title")}</Link></div>
      <div className="spread wrap" style={{ alignItems: "flex-end" }}>
        <div>
          <h1>{c.patient_name}</h1>
          <div className="meta" style={{ marginTop: 4 }}>
            <span>{age(c.dob, c.today)} {t("age.y")} · RČ {c.rc}</span>
            <span>{pick(c.pathway.name, c.pathway.name_en)}</span>
            <span>MDT {fmtDate(c.mdt_date)}</span>
            <Link to={`/koc/cases/${c.id}`}>{t("tab.pathway")}</Link>
          </div>
        </div>
        <div className="col" style={{ gap: 8, alignItems: "flex-end" }}>
          <SummaryActions c={c} />
          <DocCounts counts={c.doc_counts} />
        </div>
      </div>
      <section className="card"><div className="card-body" style={{ paddingTop: 2 }}><JourneyTimeline c={c} /></div></section>

      <div className="mdt-grid">
        <aside className="mdt-body">
          <BodyMap caseId={c.id} filter={filter} onFilter={setFilter} hoverDoc={hoverDoc} />
        </aside>
        <div className="col" style={{ gap: 28, minWidth: 0 }}>
          {brief && (
            <section>
              <div className="section-title">{t("mdt.brief")}</div>
              <div className="small" style={{ marginBottom: 6 }}><b>{brief.diagnosis.name}</b> <span className="muted">· {brief.diagnosis.icd10}</span></div>
              <table className="small"><tbody>
                {brief.results.filter((r) => shown(r.doc_id)).map((r, i) => (
                  <tr key={i} onMouseEnter={() => setHoverDoc(r.doc_id)} onMouseLeave={() => setHoverDoc(null)}>
                    <td className="muted" style={{ whiteSpace: "nowrap", width: 90 }}>{fmtDate(r.date)}</td>
                    <td><span style={{ fontWeight: 550 }}>{r.exam.split(" (")[0]}</span><div className="muted">{r.result}</div></td>
                    <td style={{ width: 40 }}>{r.doc_id && <a className="cite" href={`/api/documents/${r.doc_id}/raw`}>D{r.doc_id}</a>}</td>
                  </tr>
                ))}
              </tbody></table>
              <div className="small muted" style={{ marginTop: 6 }}>OA: {brief.comorbidities.join("; ")}</div>
            </section>
          )}
          {(conflicts.length > 0 || missing.length > 0 || waived.length > 0 || (brief?.missing.length ?? 0) > 0) && (
            <section>
              <div className="section-title">{t("mdt.warnings")}</div>
              <div className="col small" style={{ gap: 4 }}>
                {conflicts.map((f) => <Status key={f.key} color="yellow">{pick(f.detail, f.detail_en)}</Status>)}
                {missing.map((n) => <Status key={n.id} color="red">{t("doc.missing")}: {pick(n.label, n.label_en)}</Status>)}
                {waived.map((n) => <Status key={n.id} color="orange">{t("doc.waived")}: {pick(n.label, n.label_en)}{n.waived ? ` (${n.waived.by})` : ""}</Status>)}
                {brief?.missing.map((m) => <Status key={m.key} color="gray">{t("hv.missing")}: {pick(m.label, (m as { label_en?: string }).label_en)}</Status>)}
              </div>
            </section>
          )}
          <Imaging c={c} />
          <LabTrends caseId={c.id} cutoff={c.mdt_date} />
          <AskPanel c={c} />
          <DecisionPanel c={c} brief={brief} reload={reload} />
        </div>
        <aside className="mdt-docs">
          <div className="section-title">{t("mdt.docs")}</div>
          {c.documents.filter((d) => shown(d.id)).map((d) => (
            <a key={d.id} href={`/api/documents/${d.id}/raw`} onMouseEnter={() => setHoverDoc(d.id)} onMouseLeave={() => setHoverDoc(null)} style={{ display: "block", padding: "7px 0", borderTop: "1px solid var(--line)", textDecoration: "none", color: "inherit", opacity: d.post_mdt ? 0.5 : 1 }}>
              <div className="small" style={{ fontWeight: 550 }}>{d.title || d.filename}</div>
              <div className="xs muted">D{d.id} · {fmtDate(d.doc_date)}{d.post_mdt ? ` · ${t("docs.afterMdt")}` : ""}</div>
            </a>
          ))}
          {c.mdt_report_ready && <a className="btn sm" style={{ marginTop: 10 }} href={`/api/cases/${c.id}/mdt/report.docx`}>MDT_zapis.docx</a>}
        </aside>
      </div>
    </div>
  );
}
