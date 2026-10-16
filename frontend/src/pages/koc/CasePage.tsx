import { Link, useParams, useSearchParams } from "react-router-dom";
import { fmtDate } from "../../api";
import { DocCounts, Progress, StateTag } from "../../components/ui";
import { useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { CaseDetail } from "../../types";
import AuditTab from "./case/AuditTab";
import DocumentsTab from "./case/DocumentsTab";
import GraphTab from "./case/GraphTab";
import HandoverTab from "./case/HandoverTab";
import PathwayTab from "./case/PathwayTab";
import ResultTab from "./case/ResultTab";

const TABS = ["pathway", "handover", "documents", "graph", "result", "audit"] as const;

export function age(dob: string | null, today: string): number | null {
  if (!dob) return null;
  const d = new Date(dob), n = new Date(today);
  return n.getFullYear() - d.getFullYear() - (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
}

export default function CasePage() {
  const { id } = useParams();
  const { t, pick } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "pathway";
  const { data: c, error, reload } = useFetch<CaseDetail>(`/api/cases/${id}`, 5000);
  if (error) return <div className="page"><div className="callout red">{error}</div></div>;
  if (!c) return <div className="page muted">{t("common.loading")}</div>;
  const go = (x: string) => setParams({ tab: x });

  return (
    <div className="page wide" style={{ gap: 16 }}>
      <div className="small"><Link to="/koc" className="muted">{t("koc.title")}</Link></div>
      <div className="spread wrap" style={{ alignItems: "flex-end" }}>
        <div>
          <h1>{c.patient_name}</h1>
          <div className="meta" style={{ marginTop: 4 }}>
            <span>{age(c.dob, c.today)} · RČ {c.rc}</span>
            <span>{pick(c.pathway.name, c.pathway.name_en)} v{c.pathway.version}</span>
            <span>{t("referred")} {fmtDate(c.created_on)} · {c.referring_doctor?.name}</span>
            {c.mdt_date && <span>MDT {fmtDate(c.mdt_date)}</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 16 }}><DocCounts counts={c.doc_counts} /><StateTag state={c.state} /></div>
      </div>
      <Progress states={c.states} index={c.state_index} />
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => go(k)}>{t(`tab.${k}`)}</button>
        ))}
      </div>
      {tab === "pathway" && <PathwayTab c={c} reload={reload} go={go} />}
      {tab === "handover" && <HandoverTab c={c} reload={reload} />}
      {tab === "documents" && <DocumentsTab c={c} reload={reload} />}
      {tab === "graph" && <GraphTab c={c} />}
      {tab === "result" && <ResultTab c={c} reload={reload} />}
      {tab === "audit" && <AuditTab c={c} />}
    </div>
  );
}
