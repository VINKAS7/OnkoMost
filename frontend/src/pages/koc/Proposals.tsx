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
      <div className="bar" title={`${t("pr.needs")} ${tl.needed}/${tl.total_kocs}`}>
        <span style={{ width: pct(tl.yes), background: "var(--green)" }} />
        <span style={{ width: pct(tl.no), background: "var(--red)" }} />
        <span style={{ width: pct(tl.abstain), background: "var(--faint)" }} />
        <i style={{ position: "absolute", left: pct(tl.needed - 0.5), top: -3, bottom: -3, borderLeft: "2px dashed var(--text)" }} />
      </div>
      <div className="xs muted">{tl.yes} {t("pr.yes")} · {tl.no} {t("pr.no")} · {tl.abstain} {t("pr.abstain")} · {tl.not_voted} — {t("pr.needs")} <b>{tl.needed} {t("pr.of")} {tl.total_kocs}</b> KOC</div>
    </div>
  );
}

export const PROPOSAL_COLOR: Record<string, string> = { accepted: "green", rejected: "red", voting: "orange" };

export default function Proposals() {
  const { t } = useApp();
  const { data } = useFetch<Proposal[]>("/api/proposals");
  return (
    <div className="page">
      <PageHead title={t("pr.title")} lead={t("pr.sub")} />
      <div className="col" style={{ gap: 8 }}>
        {(data ?? []).map((p) => (
          <Link key={p.id} to={`/koc/proposals/${p.id}`} className="row-link">
            <div className="spread"><b>{p.title}</b><Tag color={PROPOSAL_COLOR[p.status]}>{p.status}</Tag></div>
            <div className="xs muted">{p.pathway} · v{p.base_version} → v{p.draft_version} · {p.author} · {fmtDate(p.deadline)}</div>
            <div style={{ marginTop: 8, maxWidth: 520 }}><Tally tl={p.tally} /></div>
          </Link>
        ))}
        {data && !data.length && <Empty>{t("pr.empty")}</Empty>}
      </div>
    </div>
  );
}
