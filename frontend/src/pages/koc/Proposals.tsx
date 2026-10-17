import { Link } from "react-router-dom";
import { fmtDate } from "../../api";
import { Empty, PageHead, Tag } from "../../components/ui";
import { useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { Proposal } from "../../types";

export function Tally({ tl }: { tl: Proposal["tally"] }) {
  const { t } = useApp();
  const pct = (n: number) => `${(n / tl.total_kocs) * 100}%`;
  return (
    <div className="col" style={{ gap: 4 }}>
      {/* the threshold tick sits outside the bar, whose overflow clips; YES has to reach it */}
      <div style={{ position: "relative", padding: "4px 0" }} title={`${t("pr.needs")} ${tl.needed}/${tl.total_kocs}`}>
        <div className="bar">
          <span style={{ width: pct(tl.yes), background: "var(--green)" }} />
          <span style={{ width: pct(tl.no), background: "var(--red)" }} />
          <span style={{ width: pct(tl.abstain), background: "var(--faint)" }} />
        </div>
        <i style={{ position: "absolute", left: `calc(${pct(tl.needed)} - 1px)`, top: 0, bottom: 0, width: 2, borderRadius: 1, background: "var(--text)" }} />
      </div>
      <div className="xs muted">{tl.yes} {t("pr.yes")} · {tl.no} {t("pr.no")} · {tl.abstain} {t("pr.abstain")} · {tl.not_voted} {t("pr.notVoted")} — {t("pr.needs")} <b>{tl.needed} {t("pr.of")} {tl.total_kocs}</b> {t("pr.toPass")}</div>
    </div>
  );
}

/** "v1 → v2" for a change, "new pathway · C61" for a new cancer type */
export const proposalWhat = (p: Proposal, t: (k: string) => string) =>
  p.new_pathway ? `${t("pr.newPathway")} · ${(p.icd_codes ?? []).join(", ")}` : `v${p.base_version} → v${p.draft_version}`;

export const PROPOSAL_COLOR: Record<string, string> = { accepted: "green", rejected: "red", voting: "orange" };

export default function Proposals() {
  const { t, pick } = useApp();
  const { data } = useFetch<Proposal[]>("/api/proposals");
  return (
    <div className="page">
      <PageHead title={t("pr.title")} lead={t("pr.sub")} />
      <div className="col" style={{ gap: 8 }}>
        {(data ?? []).map((p) => (
          <Link key={p.id} to={`/koc/proposals/${p.id}`} className="row-link">
            <div className="spread"><b>{p.title}</b><Tag color={PROPOSAL_COLOR[p.status]}>{p.status}</Tag></div>
            <div className="xs muted">{pick(p.pathway, p.pathway_en)} · {proposalWhat(p, t)} · {p.author} · {fmtDate(p.deadline)}</div>
            <div style={{ marginTop: 8, maxWidth: 520 }}><Tally tl={p.tally} /></div>
          </Link>
        ))}
        {data && !data.length && <Empty>{t("pr.empty")}</Empty>}
      </div>
    </div>
  );
}
