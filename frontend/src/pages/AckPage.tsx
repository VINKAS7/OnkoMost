import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate } from "../api";
import { Callout, LangSwitch, ThemeSwitch } from "../components/ui";
import { useAction, useApp } from "../ctx";
import { useFetch } from "../hooks";
import type { Message } from "../types";

/** What the referring doctor sees when they open the link in the result message. */
export default function AckPage() {
  const { token } = useParams();
  const { t } = useApp();
  const { data: m, error, reload } = useFetch<Message>(`/api/ack/${token}`);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState(false);
  const { run, busy } = useAction();
  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <div className="spread"><div className="row"><b>Onkomost</b><span className="muted">· {t("ack.title")}</span></div><div className="row"><ThemeSwitch /><LangSwitch /></div></div>
      {error && <Callout color="red">{error}</Callout>}
      {m && (
        <section className="block col">
          <h2>{m.subject}</h2>
          <div className="xs muted">{m.to_name} · {fmtDate(m.sent_on)}</div>
          <div className="msg">{m.body}</div>
          {m.case_id && (
            <div className="row wrap small">{m.attachments.map((a) => a.document_id ? <a key={a.name} href={`/api/documents/${a.document_id}/raw`}>{a.name}</a> :
              a.report_path ? <a key={a.name} href={`/api/cases/${m.case_id}/mdt/report.docx`}>{a.name}</a> :
              <a key={a.name} href={`/api/cases/${m.case_id}/handover.txt`} target="_blank" rel="noreferrer">{a.name}</a>)}</div>
          )}
          {m.acked_on ? <Callout color="green">{t("ack.done")} ({fmtDate(m.acked_on)}, {m.acked_by})</Callout> : (
            <div className="row wrap">
              <input placeholder={t("ack.name")} value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 240 }} />
              <button className="primary" disabled={!name || busy} onClick={() => run(() => api.post(`/api/ack/${token}`, { by: name }), t("ack.done"), reload)}>{t("ack.confirm")}</button>
            </div>
          )}
          {m.kind === "feedback_review" && (
            <div className="col" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <b className="small">{t("msg.reviewAsk")}</b>
              {asked ? <Callout color="green">{t("msg.reviewSent")}</Callout> : (
                <>
                  <textarea value={question} onChange={(e) => setQuestion(e.target.value)} />
                  <div><button className="sm" disabled={!question.trim() || !name.trim() || busy}
                    onClick={() => run(() => api.post(`/api/ack/${token}/question`, { by: name, body: question }), t("msg.reviewSent"), () => setAsked(true))}>{t("msg.send")}</button>
                    {!name.trim() && <span className="xs muted" style={{ marginLeft: 8 }}>{t("ack.name")}</span>}</div>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
