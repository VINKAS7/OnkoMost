import { useEffect, useState } from "react";
import { api, fmtDate } from "../../api";
import { IdentityFiles, keepAfterReferral } from "../../components/IdentityCheck";
import { DocCounts, Empty, PageHead, Status } from "../../components/ui";
import { useAction, useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { CaseMessage, CaseSummary, PathwayInfo } from "../../types";

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
            <label className="linkbtn">{t("msg.gpUpload")}<input type="file" multiple hidden accept=".docx,.txt,.png,.jpg,.jpeg" onChange={(e) => upload(e.target.files)} /></label>
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
  const [idState, setIdState] = useState({ pending: false, undecided: 0, kept: [] as string[] });
  const { data: pathways } = useFetch<PathwayInfo[]>("/api/pathways");
  const { data: mine, reload } = useFetch<CaseSummary[]>(me ? `/api/cases?referrer=${encodeURIComponent(me)}` : null, 8000);
  useEffect(() => { save("onkomost.gp", me); save("onkomost.gp.practice", practice); }, [me, practice]);

  const add = (list: FileList | null) => list && setFiles((f) => [...f, ...Array.from(list)]);
  const submit = () => {
    const fd = new FormData();
    Object.entries({ koc_id: koc, pathway_id: pathway, patient_name: name, rc, referrer_name: me, referrer_practice: practice })
      .forEach(([k, v]) => fd.append(k, String(v)));
    files.forEach((f) => fd.append("files", f));
    const kept = idState.kept;
    run(async () => { const r = await api.post<{ case_id: number }>("/api/referrals", fd); await keepAfterReferral(r.case_id, kept, me); return r; },
      t("gp.sent"), () => { setName(""); setRc(""); setFiles([]); reload(); });
  };
  const ready = name.trim() && /^\d{6}\/?\d{3,4}$/.test(rc.replace(/\s/g, "")) && pathway && files.length > 0
    && !idState.pending && !idState.undecided;

  return (
    <div className="page">
      <PageHead title={t("gp.title")} lead={t("gp.sub")} />
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
        <section className="col" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="field grow">{t("gp.pname")}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field" style={{ width: 200 }}>{t("gp.rc")}<input value={rc} onChange={(e) => setRc(e.target.value)} placeholder={t("gp.rc.ph")} /></label>
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
              <input type="file" multiple hidden accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" onChange={(e) => add(e.target.files)} />
            </label>
            <IdentityFiles files={files} name={name} rc={rc} setName={setName} setRc={setRc}
              removeFile={(i) => setFiles(files.filter((_, j) => j !== i))} onState={setIdState} />
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="field grow">{t("gp.name")}<input value={me} onChange={(e) => setMe(e.target.value)} /></label>
            <label className="field grow">{t("gp.practice")}<input value={practice} onChange={(e) => setPractice(e.target.value)} /></label>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <button className="primary" disabled={!ready || busy} onClick={submit}>{busy ? t("gp.sending") : t("gp.send")}</button>
            <span className="xs faint">{t("gp.next.1")}</span>
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
