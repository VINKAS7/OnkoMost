import { useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../../../api";
import { Status } from "../../../components/ui";
import { useAction, useApp } from "../../../ctx";
import type { CaseDetail, MdtReport } from "../../../types";

export function ReportView({ r }: { r: MdtReport }) {
  const { t } = useApp();
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="small"><b>{r.diagnosis.name}</b> <span className="muted">· {r.diagnosis.icd10 || "—"}</span></div>
      <table className="small">
        <tbody>{r.results.map((x, i) => (
          <tr key={i}><td className="muted" style={{ whiteSpace: "nowrap", width: 90 }}>{fmtDate(x.date)}</td><td><span style={{ fontWeight: 550 }}>{x.exam}</span><div className="muted">{x.result}</div></td></tr>
        ))}</tbody>
      </table>
      {r.missing.length > 0 && <Status color="red">{t("hv.missing")}: {r.missing.map((m) => m.label).join(", ")}</Status>}
      {r.excluded_documents.length > 0 && <Status color="gray">{t("res.excluded")}: {r.excluded_documents.map((d) => d.title).join("; ")}</Status>}
    </div>
  );
}

function Step({ n, title, right, children }: { n: number; title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      <div className="spread wrap" style={{ marginBottom: children ? 10 : 0 }}>
        <div className="row"><span className="muted">{n}.</span><b>{title}</b></div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function ResultTab({ c, reload }: { c: CaseDetail; reload: () => void }) {
  const { actor, t } = useApp();
  const { run, busy } = useAction();
  const [report, setReport] = useState<MdtReport | null>(null);
  const [mdtDate, setMdtDate] = useState(c.mdt_date ?? "");
  const gp = c.messages.find((m) => m.kind === "feedback_gp");
  const review = c.messages.find((m) => m.kind === "feedback_review");
  const k2 = c.pathway_graph.nodes.find((n) => n.id === "handover_k2");
  const mc = c.mdt_conclusion;

  return (
    <div className="col" style={{ gap: 22, maxWidth: 980 }}>
      <Step n={1} title={t("res.report")} right={
        <div className="row wrap">
          <input type="date" value={mdtDate} onChange={(e) => setMdtDate(e.target.value)} aria-label={t("res.mdtDate")} />
          {mdtDate !== (c.mdt_date ?? "") && <button className="sm" disabled={!mdtDate || busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/mdt/date`, { date: mdtDate, by: actor }), "✓", reload)}>{t("res.saveDate")}</button>}
          <button className="sm" disabled={!c.mdt_date || busy} onClick={() => run(() => api.post<MdtReport>(`/api/cases/${c.id}/mdt/report`, { by: actor }), "✓", (r) => { setReport(r); reload(); })}>{t("res.generate")}</button>
          {c.mdt_report_ready && <a className="btn sm" href={`/api/cases/${c.id}/mdt/report.docx`}>{mc ? t("res.finalRecord") : t("res.briefing")} .docx</a>}
        </div>}>
        {report && <ReportView r={report} />}
      </Step>

      <Step n={2} title={t("res.decision")} right={<Link to={`/mdt/cases/${c.id}`} className="small">{t("res.openMdt")}</Link>}>
        {mc ? (
          <div className="col">
            <div className="meta"><span style={{ color: "var(--text)", fontWeight: 600 }}>{c.treatments.map((k) => t(`tr.${k}`)).join(" + ")}</span><span>{mc.recorded_by}</span><span>{fmtDate(mc.recorded_on)}</span></div>
            <div className="msg">{mc.conclusion}</div>
          </div>
        ) : <div className="small muted">{t("res.waitingMdt")}</div>}
      </Step>

      <Step n={3} title={t("res.feedback")} right={!gp && <button className="primary sm" disabled={!c.treatments.length || busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/feedback`, { by: actor }), "✓", reload)}>{t("res.send")}</button>}>
        {gp && (
          <div className="col" style={{ gap: 6 }}>
            <div className="spread"><span className="small">{gp.to_name}</span>{gp.acked_on ? <Status color="green">{t("res.receipt")} {fmtDate(gp.acked_on)}</Status> : <Status color="orange">{t("res.waitReceipt")}</Status>}</div>
            {review && <div className="spread"><span className="small">{review.to_name}</span><Status color="blue">{t("res.auto")}</Status></div>}
            <details><summary className="xs muted">{gp.subject}</summary><div className="msg" style={{ marginTop: 6, maxHeight: 300, overflow: "auto" }}>{gp.body}</div></details>
            {!gp.acked_on && gp.ack_token && <Link to={`/ack/${gp.ack_token}`} target="_blank" className="small">/ack/…</Link>}
          </div>
        )}
      </Step>

      <Step n={4} title={t("res.k2")} right={k2?.status === "done" ? <Status color="green">{t("res.handed")} {fmtDate(k2.done_on)}</Status> :
        <button className="primary sm" disabled={k2?.status !== "available" || busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/steps/handover_k2/complete`, { by: actor, note: "K2" }), "✓", reload)}>{t("res.handK2")}</button>} />
    </div>
  );
}
