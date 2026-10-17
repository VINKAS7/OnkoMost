import { useState } from "react";
import { api, fmtDate } from "../../../api";
import { Empty, Tag } from "../../../components/ui";
import { useAction, useApp } from "../../../ctx";
import { HIDDEN_KINDS, kindLabel } from "../../../facts";
import type { CaseDetail } from "../../../types";

export default function DocumentsTab({ c, reload }: { c: CaseDetail; reload: () => void }) {
  const { t, lang } = useApp();
  const { run, busy } = useAction();
  const [over, setOver] = useState(false);
  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    run(() => api.post(`/api/cases/${c.id}/documents`, fd), `✓ ${files.length}`, reload);
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <label className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
        {t("docs.drop")}
        <input type="file" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} />
      </label>
      <section style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>{t("docs.date")}</th><th>{t("docs.doc")}</th><th>{t("docs.from")}</th><th>{t("docs.status")}</th><th>{t("docs.extracted")}</th><th /></tr></thead>
          <tbody>
            {c.documents.map((d) => (
              <tr key={d.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(d.doc_date)}{d.post_mdt && <div><Tag color="yellow">{t("docs.afterMdt")}</Tag></div>}</td>
                <td>
                  <b>{d.title || d.filename}</b>
                  <div className="xs muted">{d.doc_type} · {d.filename}</div>
                  {d.identity?.issues?.length ? <div className="xs" style={{ color: d.status === "blocked" ? "var(--red)" : "var(--muted)" }}>{d.identity.issues.join("; ")}</div> : null}
                  {d.error && <div className="xs" style={{ color: "var(--red)" }}>{d.error}</div>}
                </td>
                <td className="small">{d.facility}<div className="muted xs">{d.author}</div></td>
                <td>
                  <Tag color={d.status === "done" ? "green" : d.status === "blocked" || d.status === "error" ? "red" : "purple"}>{d.status === "blocked" ? t("docs.blocked") : t(`dst.${d.status}`)}</Tag>
                  {d.identity?.ok && <div className="xs muted" style={{ marginTop: 3 }} title={t("docs.idOk")}>✓ {d.identity.matched_on?.map((m) => (m === "rc" ? "RČ" : m)).join(" + ")}</div>}
                </td>
                <td className="small">
                  <div className="row wrap" style={{ gap: 3 }}>
                    {d.summary?.facts && Object.entries(d.summary.facts).filter(([k]) => !HIDDEN_KINDS.has(k)).map(([k, v]) => <Tag key={k}>{kindLabel(k, lang)} {v}</Tag>)}
                    {!!d.summary?.llm_items && <Tag color="purple">{d.summary.llm_items} {t("docs.byAi")}</Tag>}
                    {!!d.summary?.unverified && <Tag color="yellow">{d.summary.unverified} {t("docs.toCheck")}</Tag>}
                    {!!d.summary?.flags && <Tag color="yellow">{d.summary.flags} {t("doc.conflict").toLowerCase()}</Tag>}
                  </div>
                </td>
                <td className="row">
                  <a className="btn sm" href={`/api/documents/${d.id}/raw`}>{t("docs.original")}</a>
                  {d.doc_type !== "mdt_conclusion" && <button className="sm ghost" disabled={busy} onClick={() => run(() => api.post(`/api/documents/${d.id}/reprocess`), "✓", reload)}>{t("docs.rerun")}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!c.documents.length && <Empty>—</Empty>}
      </section>
      {c.doc_requests.length > 0 && (
        <section>
          <div className="section-title">{t("docs.requested")}</div>
          <table style={{ marginTop: 6 }}><tbody>{c.doc_requests.map((r) => (
            <tr key={r.id}><td>{r.item} ({fmtDate(r.item_date)})</td><td className="muted">{r.facility}</td><td>{fmtDate(r.requested_on)}</td>
              <td>{r.status === "received" ? <Tag color="green">{t("docs.received")} {fmtDate(r.received_on)}</Tag> : <Tag color="orange">{t("docs.waiting")}</Tag>}</td></tr>
          ))}</tbody></table>
        </section>
      )}
    </div>
  );
}
