import { Link, useParams, useSearchParams } from "react-router-dom";
import { fmtDate } from "../../api";
import { Icon } from "../../components/Icon";
import { JourneyTimeline } from "../../components/JourneyTimeline";
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
      <div className="crumbs">
        <Link to="/koc">{t("koc.title")}</Link>
        <Icon name="chevron" />
        <span style={{ color: "var(--text)", fontWeight: 550 }}>{c.patient_name}</span>
      </div>
      <section className="card">
        <div className="card-body col" style={{ gap: 18, padding: "20px 22px" }}>
          <div className="spread wrap" style={{ alignItems: "center" }}>
            <div className="row" style={{ gap: 16 }}>
              <span className="avatar">{c.patient_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
              <div>
                <h1 style={{ fontSize: 26 }}>{c.patient_name}</h1>
                <div className="meta" style={{ marginTop: 4 }}>
                  <span>{age(c.dob, c.today)} {t("age.y")} · RČ {c.rc}</span>
                  <span>{pick(c.pathway.name, c.pathway.name_en)} v{c.pathway.version}{c.pathway.label && ` · ${c.pathway.label}`}</span>
                  <span>{t("referred")} {fmtDate(c.created_on)} · {c.referring_doctor?.name}</span>
                  {c.mdt_date && <span>MDT {fmtDate(c.mdt_date)}</span>}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 16 }}><DocCounts counts={c.doc_counts} /><StateTag state={c.state} /></div>
          </div>
          <Progress states={c.states} index={c.state_index} />
          <JourneyTimeline c={c} />
        </div>
      </section>
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
