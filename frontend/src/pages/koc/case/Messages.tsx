import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { api, fmtDate } from "../../../api";
import { Empty, Status } from "../../../components/ui";
import { useAction, useApp } from "../../../ctx";
import { useFetch } from "../../../hooks";
import type { CaseDetail, CaseMessage } from "../../../types";

export type MessagesHandle = { askGp: () => void; reply: (to: "gp" | "review", replyTo?: number) => void };

/** Coordinator ↔ referring doctor, and answers to the insurer's review doctor (slides 8 and 11). */
const Messages = forwardRef<MessagesHandle, { c: CaseDetail; reload: () => void }>(function Messages({ c, reload }, ref) {
  const { t, actor } = useApp();
  const { run, busy } = useAction();
  const { data: msgs, reload: reloadMsgs } = useFetch<CaseMessage[]>(`/api/cases/${c.id}/messages`, 8000);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<"gp" | "review">("gp");
  const [replyTo, setReplyTo] = useState<number | undefined>();
  const [body, setBody] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const suggest = () => run(() => api.get<{ body: string }>(`/api/cases/${c.id}/messages/draft`), undefined, (r) => setBody(r.body));
  useImperativeHandle(ref, () => ({
    askGp: () => { setTo("gp"); setReplyTo(undefined); setOpen(true); suggest(); box.current?.scrollIntoView({ behavior: "smooth", block: "center" }); },
    reply: (target, id) => { setTo(target); setReplyTo(id); setBody(""); setOpen(true); box.current?.scrollIntoView({ behavior: "smooth", block: "center" }); },
  }));
  const send = () => run(() => api.post(`/api/cases/${c.id}/messages`, { author_role: "coordinator", author: actor, body, to_role: to, reply_to: replyTo }),
    "✓", () => { setBody(""); setOpen(false); setReplyTo(undefined); reloadMsgs(); reload(); });
  const reviewOpen = (msgs ?? []).find((m) => m.author_role === "review" && !m.resolved);

  return (
    <section ref={box}>
      <div className="spread">
        <div className="section-title" style={{ margin: 0 }}>{t("msg.title")}</div>
        {!open && <button className="linkbtn" onClick={() => { setOpen(true); setTo(reviewOpen ? "review" : "gp"); setReplyTo(reviewOpen?.id); }}>{t("msg.send")}…</button>}
      </div>
      <div className="col" style={{ gap: 8, marginTop: 8 }}>
        {(msgs ?? []).map((m) => (
          <div key={m.id} style={{ borderLeft: `2px solid var(--${m.author_role === "coordinator" ? "line-strong" : m.author_role === "gp" ? "green" : "purple"})`, paddingLeft: 10 }}>
            <div className="meta">
              <span style={{ color: "var(--text)", fontWeight: 550 }}>{t(`msg.role.${m.author_role}`)}</span>
              <span>{m.author}</span><span>{fmtDate(m.on)}</span>
              {m.author_role !== "coordinator" || m.to_role === "gp" ? (m.resolved ? <span>{t("msg.answered")}</span> : <span style={{ color: "var(--orange)" }}>{t("msg.open")}</span>) : null}
            </div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            {m.author_role === "review" && !m.resolved && <button className="linkbtn" onClick={() => { setOpen(true); setTo("review"); setReplyTo(m.id); }}>{t("msg.reply")}</button>}
          </div>
        ))}
        {msgs && !msgs.length && !open && <Empty>{t("msg.empty")}</Empty>}
      </div>
      {open && (
        <div className="col" style={{ gap: 6, marginTop: 10 }}>
          <div className="row wrap">
            <select value={to} onChange={(e) => setTo(e.target.value as "gp" | "review")} style={{ minHeight: 28 }}>
              <option value="gp">{t("msg.toGp")}</option>
              <option value="review">{t("msg.toReview")}</option>
            </select>
            {to === "gp" && <button className="linkbtn" onClick={suggest}>{t("msg.suggest")}</button>}
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 130 }} />
          <div className="row">
            <button className="primary sm" disabled={!body.trim() || busy} onClick={send}>{t("msg.send")}</button>
            <button className="sm ghost" onClick={() => { setOpen(false); setBody(""); }}>{t("act.cancel")}</button>
            {reviewOpen && to === "review" && <Status color="purple">{t("msg.role.review")}: {reviewOpen.body.slice(0, 60)}</Status>}
          </div>
        </div>
      )}
    </section>
  );
});

export default Messages;
