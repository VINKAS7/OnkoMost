import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate } from "../../api";
import { Empty, PageHead, Tag } from "../../components/ui";
import { useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { Message } from "../../types";


export default function Outbox() {
  const { t } = useApp();
  const { data } = useFetch<Message[]>("/api/outbox", 10000);
  const [sel, setSel] = useState<number | null>(null);
  const m = data?.find((x) => x.id === sel) ?? data?.[0];
  return (
    <div className="page wide">
      <PageHead title={t("out.title")} lead={t("out.sub")} />
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr)" }}>
        <div className="block list" style={{ padding: 6 }}>
          {(data ?? []).map((x) => (
            <div key={x.id} onClick={() => setSel(x.id)} style={{ padding: 10, cursor: "pointer", borderRadius: 6, background: m?.id === x.id ? "var(--hover)" : undefined }}>
              <div className="spread"><b className="small">{x.to_name}</b><span className="xs muted">{fmtDate(x.sent_on)}</span></div>
              <div className="small">{x.subject}</div>
              {x.ack_token && <div style={{ marginTop: 4 }}>{x.acked_on ? <Tag color="green">{t("res.receipt")}</Tag> : <Tag color="orange">{t("res.waitReceipt")}</Tag>}</div>}
            </div>
          ))}
          {data && !data.length && <Empty>—</Empty>}
        </div>
        {m && (
          <section className="block col">
            <div className="spread"><h3>{m.subject}</h3>{m.case_id && <Link to={`/koc/cases/${m.case_id}`}>#{m.case_id}</Link>}</div>
            <div className="xs muted">{t("out.to")}: {m.to_name}{m.to_role && ` (${m.to_role})`} · {t("out.sent")} {fmtDate(m.sent_on)}</div>
            <div className="msg">{m.body}</div>
            {!!m.attachments?.length && <div className="small row wrap">{m.attachments.map((a) => a.document_id ? <a key={a.name} href={`/api/documents/${a.document_id}/raw`}>{a.name}</a> : a.report_path && m.case_id ? <a key={a.name} href={`/api/cases/${m.case_id}/mdt/report.docx`}>{a.name}</a> : <span key={a.name}>{a.name}</span>)}</div>}
            {m.ack_token && !m.acked_on && <Link to={`/ack/${m.ack_token}`} target="_blank" className="btn sm">{t("ack.confirm")}</Link>}
          </section>
        )}
      </div>
    </div>
  );
}
