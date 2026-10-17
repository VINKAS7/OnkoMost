import { Link } from "react-router-dom";
import { fmtDate } from "../../api";
import { Due, Empty, PageHead, StateTag } from "../../components/ui";
import { useApp } from "../../ctx";
import { dayNum } from "../../facts";
import { useFetch } from "../../hooks";
import type { CaseSummary } from "../../types";

const QUEUES: CaseSummary["queue"][] = ["new", "active", "on_hold", "closed"];
const LANE_DOT: Record<string, string> = { new: "blue", active: "purple", on_hold: "orange", closed: "green" };

function CaseCard({ c }: { c: CaseSummary }) {
  const { t, pick } = useApp();
  const n = c.next_task;
  const total = (c.doc_counts.have ?? 0) + (c.doc_counts.missing ?? 0) + (c.doc_counts.conflict ?? 0);
  return (
    <Link to={`/koc/cases/${c.id}`} className="row-link">
      <div className="spread" style={{ alignItems: "flex-start" }}><b style={{ fontSize: 15 }}>{c.patient_name}</b><StateTag state={c.state} /></div>
      <div className="meta" style={{ marginTop: 2 }}>
        <span>{pick(c.pathway.name, c.pathway.name_en)}</span>
        <span>{c.koc.code}</span>
        <span>{c.doc_counts.have ?? 0}/{total} {t("tab.documents").toLowerCase()}</span>
        {!!c.doc_counts.conflict && <span style={{ color: "var(--yellow)" }}>{c.doc_counts.conflict} {t("doc.conflict").toLowerCase()}</span>}
      </div>
      {n && (
        <div className="small" style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--sunken)", border: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 550 }}>{pick(n.title, n.title_en)}</div>
          <div className="meta"><span>{n.owner_name}</span><Due task={n} /></div>
        </div>
      )}
      {!n && c.closed_on && <div className="meta" style={{ marginTop: 8 }}><span>{t("st.closed")} {fmtDate(c.closed_on)}</span></div>}
    </Link>
  );
}

export default function Dashboard() {
  const { kocId, koc, kocs, setKocId, t } = useApp();
  // fetch every centre once and filter here, so we can point to patients at another centre
  const { data, error } = useFetch<CaseSummary[]>("/api/cases", 8000);
  const all = data ?? [];
  const cases = kocId ? all.filter((c) => c.koc.id === kocId) : all;
  const elsewhere = kocs.filter((k) => k.id !== kocId && all.some((c) => c.koc.id === k.id));
  const open = cases.filter((c) => c.queue !== "closed");
  const overdue = open.reduce((a, c) => a + c.overdue_tasks, 0);
  const tasks = open.reduce((a, c) => a + c.open_tasks, 0);
  // diagnostic interval: referral → MDT, median over this centre's cases that had their MDT
  const spans = cases.filter((c) => c.mdt_date).map((c) => dayNum(c.mdt_date!) - dayNum(c.created_on)).sort((a, b) => a - b);
  const median = spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2) : null;
  const kpis: [string, string | number, string, string?][] = [
    [t("kpi.care"), open.length, t("kpi.care.sub")],
    [t("kpi.tasks"), tasks, t("kpi.tasks.sub")],
    [t("kpi.overdue"), overdue, t("kpi.overdue.sub"), overdue ? "var(--red)" : undefined],
    [t("kpi.mdtDays"), median ?? "—", median != null ? `${t("kpi.mdtDays.sub")} · n = ${spans.length}` : t("kpi.noMdt")],
  ];
  return (
    <div className="page wide">
      <PageHead title={t("koc.title")} lead={koc ? koc.coordinator_name : t("top.all")} />
      <div className="kpis">
        {kpis.map(([label, value, sub, color]) => (
          <div key={label} className="kpi">
            <span className="kpi-label">{label}</span>
            <b style={color ? { color } : undefined}>{value}</b>
            <span className="kpi-sub">{sub}</span>
          </div>
        ))}
      </div>
      {error && <div className="callout red">{error}</div>}
      {data && !cases.length && elsewhere.length > 0 && (
        <div className="callout yellow"><div className="grow row wrap">{t("koc.elsewhere")}
          {elsewhere.map((k) => <button key={k.id} className="sm" onClick={() => setKocId(k.id)}>{k.name} ({all.filter((c) => c.koc.id === k.id).length})</button>)}
        </div></div>
      )}
      <div className="grid4">
        {QUEUES.map((q) => {
          const list = cases.filter((c) => c.queue === q);
          return (
            <section key={q} className="lane">
              <div className="lane-head"><span className={`dot ${LANE_DOT[q]}`} />{t(`q.${q}`)}<span className="count" style={{ marginLeft: "auto" }}>{list.length}</span></div>
              {list.map((c) => <CaseCard key={c.id} c={c} />)}
              {!list.length && <Empty><span style={{ paddingLeft: 4 }}>—</span></Empty>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
