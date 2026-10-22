import { useEffect, useState } from "react";
import { api, fmtDate } from "../../api";
import { FOLDER } from "../../components/CtViewer";
import { DocCounts, Empty, PageHead, Status } from "../../components/ui";
import { useAction, useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { CaseMessage, CaseSummary, PathwayInfo } from "../../types";

const isImage = (f: File) => /\.(dcm|dicom)$/i.test(f.name);
// the file types the server reads as reports (backend/ingest/dicom.py REPORT_SUFFIXES)
const REPORT = /\.(docx|pdf|png|jpe?g|tiff?|txt)$/i;

function GpThread({ c, me, reload }: { c: CaseSummary; me: string; reload: () => void }) {
  const { t } = useApp();
  const { run, busy } = useAction();
  const [reply, setReply] = useState("");
  const thread: CaseMessage[] = c.thread ?? [];
  if (!thread.length) return null;
  const open = thread.filter((m) => m.to_role === "gp" && !m.resolved);
  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    fd.append("source", "gp");
    fd.append("actor", me);
    run(() => api.post(`/api/cases/${c.id}/documents`, fd), "✓", reload);
  };
  return (
    <div className="col" style={{ gap: 6, marginTop: 10 }}>
      <div className="section-title" style={{ margin: 0 }}>{t("msg.gpQuestions")}</div>
      {thread.map((m) => (
        <div key={m.id} className="small" style={{ borderLeft: `2px solid var(--${m.author_role === "gp" ? "green" : m.resolved ? "line-strong" : "orange"})`, paddingLeft: 8, whiteSpace: "pre-wrap" }}>
          <div className="xs muted">{t(`msg.role.${m.author_role}`)} · {fmtDate(m.on)}{m.to_role === "gp" && !m.resolved ? ` · ${t("msg.open")}` : ""}</div>
          {m.body}
        </div>
      ))}
      {open.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <textarea placeholder={t("msg.gpReply")} value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="row wrap">
            <button className="primary sm" disabled={!reply.trim() || busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/messages`, { author_role: "gp", author: me, body: reply }), "✓", () => { setReply(""); reload(); })}>{t("msg.send")}</button>
            <label className="linkbtn">{t("msg.gpUpload")}<input type="file" multiple hidden accept=".docx,.pdf,.txt,.png,.jpg,.jpeg" onChange={(e) => upload(e.target.files)} /></label>
          </div>
        </div>
      )}
    </div>
  );
}

const GP_STATUS: Record<string, [string, string]> = {
  sent: ["gp.status.sent", "gray"], in_triage: ["gp.status.sent", "gray"], waiting_for_documents: ["gp.status.diag", "orange"],
  complete: ["gp.status.mdt", "purple"], ready_for_mdt: ["gp.status.mdt", "purple"], mdt_conclusion: ["gp.status.decided", "blue"],
  feedback_sent: ["gp.status.result", "green"], closed: ["gp.status.closed", "green"],
};

function load(k: string, d: string) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function save(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

export default function GpPortal() {
  const { t, pick, kocs } = useApp();
  const { run, busy } = useAction();
  const [me, setMe] = useState(() => load("onkomost.gp", "MUDr. Tomáš Řezníček"));
  const [practice, setPractice] = useState(() => load("onkomost.gp.practice", "Ordinace praktického lékaře, Dolní Břežany"));
  const [name, setName] = useState("");
  const [rc, setRc] = useState("");
  const [pathway, setPathway] = useState<number | "">("");
  const [koc, setKoc] = useState<number>(2);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const { data: pathways } = useFetch<PathwayInfo[]>("/api/pathways");
  const { data: mine, reload } = useFetch<CaseSummary[]>(me ? `/api/cases?referrer=${encodeURIComponent(me)}` : null, 8000);
  useEffect(() => { save("onkomost.gp", me); save("onkomost.gp.practice", practice); }, [me, practice]);

  const add = (list: FileList | null) => list && setFiles((f) => [...f, ...Array.from(list)]);
  // a folder pick also brings the export's extras (LICENSE, DICOMDIR); like the server, keep only images and reports
  const skipped = files.some(isImage) ? files.filter((f) => !isImage(f) && !REPORT.test(f.name)) : [];
  const reports = files.filter((f) => !isImage(f) && !skipped.includes(f));
  const submit = () => {
    const fd = new FormData();
    Object.entries({ koc_id: koc, pathway_id: pathway, patient_name: name, rc, referrer_name: me, referrer_practice: practice })
      .forEach(([k, v]) => fd.append(k, String(v)));
    files.filter((f) => !skipped.includes(f)).forEach((f) => fd.append("files", f));
    run(() => api.post<{ case_id: number }>("/api/referrals", fd), t("gp.sent"), () => { setName(""); setRc(""); setFiles([]); reload(); });
  };
  const rcOk = /^\d{6}\/?\d{3,4}$/.test(rc.replace(/\s/g, ""));
  // say what still blocks "Send" instead of a silently disabled button
  const missing = [!name.trim() && t("gp.pname"), !rcOk && t("gp.rc"), !pathway && t("gp.cancer"),
                   !files.length && t("gp.docs")].filter(Boolean) as string[];

  return (
    <div className="page">
      <PageHead title={t("gp.title")} lead={t("gp.sub")} />
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
        <section className="col" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="field grow">{t("gp.pname")}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field" style={{ width: 200 }}>{t("gp.rc")}<input value={rc} onChange={(e) => setRc(e.target.value)} placeholder={t("gp.rc.ph")} />
              {rc.trim() && !rcOk && <span className="xs" style={{ color: "var(--red)" }}>{t("gp.rc.bad")}</span>}
            </label>
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="field grow">{t("gp.cancer")}
              <select value={pathway} onChange={(e) => setPathway(Number(e.target.value))}>
                <option value="">—</option>
                {(pathways ?? []).filter((p) => p.active_version_id).map((p) => <option key={p.id} value={p.id}>{pick(p.name, p.name_en)}</option>)}
              </select>
            </label>
            <label className="field grow">{t("gp.koc")}
              <select value={koc} onChange={(e) => setKoc(Number(e.target.value))}>
                {kocs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </label>
          </div>
          <div className="field">
            <span>{t("gp.docs")}</span>
            <label className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
              {t("gp.drop")}
              <div className="xs faint" style={{ marginTop: 4 }}>{t("gp.docs.d")}</div>
              <input type="file" multiple hidden accept=".docx,.pdf,.txt,.png,.jpg,.jpeg,.dcm,.zip" onChange={(e) => add(e.target.files)} />
            </label>
            <label className="linkbtn">{t("ct.uploadFolder")}
              <input type="file" multiple hidden {...FOLDER} onChange={(e) => add(e.target.files)} />
            </label>
            {reports.map((f, i) => (
              <div key={i} className="row small"><span className="grow">{f.name}</span>
                <button className="sm ghost" onClick={() => setFiles(files.filter((x) => x !== f))}>{t("act.cancel")}</button></div>
            ))}
            {files.some(isImage) && (  // a CT export is one file per slice: show it as one line
              <div className="row small"><span className="grow">{t("ct.images")}: {files.filter(isImage).length} {t("ct.files")}</span>
                <button className="sm ghost" onClick={() => setFiles(files.filter((f) => !isImage(f)))}>{t("act.cancel")}</button></div>
            )}
            {skipped.length > 0 && <div className="xs muted">{t("gp.skipped")} {skipped.map((f) => f.name).join(", ")}</div>}
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="field grow">{t("gp.name")}<input value={me} onChange={(e) => setMe(e.target.value)} /></label>
            <label className="field grow">{t("gp.practice")}<input value={practice} onChange={(e) => setPractice(e.target.value)} /></label>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <button className="primary" disabled={missing.length > 0 || busy} onClick={submit}>{busy ? t("gp.sending") : t("gp.send")}</button>
            {missing.length > 0
              ? <span className="xs" style={{ color: "var(--orange)" }}>{t("gp.missing")} {missing.join(", ")}</span>
              : <span className="xs faint">{t("gp.next.1")}</span>}
          </div>
        </section>

        <section className="col" style={{ gap: 0 }}>
          <div className="section-title">{t("gp.my")}</div>
          {(mine ?? []).map((c) => {
            const [label, color] = GP_STATUS[c.state] ?? ["gp.status.sent", "gray"];
            const fb = c.feedback;
            return (
              <div key={c.id} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                <div className="spread"><b>{c.patient_name}</b><Status color={color}>{t(label)}</Status></div>
                <div className="meta" style={{ marginTop: 2 }}><span>{pick(c.pathway.name, c.pathway.name_en)}</span><span>{fmtDate(c.created_on)}</span><span>{c.koc.name}</span></div>
                <div style={{ marginTop: 6 }}><DocCounts counts={c.doc_counts} /></div>
                <GpThread c={c} me={me} reload={reload} />
                {fb && (
                  <div style={{ marginTop: 10 }} className="col">
                    <div className="row">
                      <button className="linkbtn" onClick={() => setOpen(open === c.id ? null : c.id)}>{t("gp.result")}</button>
                      <span className="right">{fb.acked_on ? <Status color="green">{t("gp.confirmed")}</Status> :
                        <button className="primary sm" disabled={busy} onClick={() => run(() => api.post(`/api/ack/${fb.ack_token}`, { by: me }), t("gp.confirmed"), reload)}>{t("gp.confirm")}</button>}</span>
                    </div>
                    {open === c.id && <div className="msg" style={{ maxHeight: 360, overflow: "auto" }}>{fb.body}</div>}
                  </div>
                )}
              </div>
            );
          })}
          {mine && !mine.length && <Empty>{t("gp.my.empty")}</Empty>}
        </section>
      </div>
    </div>
  );
}
