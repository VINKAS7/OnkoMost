import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate } from "../../api";
import { FlowLegend, PathwayFlow } from "../../components/PathwayFlow";
import { PageHead, Tag } from "../../components/ui";
import { useAction, useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { PathwayInfo, PathwayVersion } from "../../types";

const STATUS_COLOR: Record<string, string> = { active: "green", draft: "blue", voting: "orange", retired: "gray", rejected: "red" };

export default function Pathways() {
  const { kocId, kocs, t, pick } = useApp();
  const { data: pathways } = useFetch<PathwayInfo[]>("/api/pathways");
  const [pid, setPid] = useState<number | null>(null);
  const [vid, setVid] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const { run, busy } = useAction();
  const nav = useNavigate();
  const p = pathways?.find((x) => x.id === pid) ?? pathways?.[0];
  useEffect(() => { if (p) setVid(p.active_version_id ?? p.versions[0]?.id ?? null); }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: version } = useFetch<PathwayVersion>(vid ? `/api/pathway-versions/${vid}` : null);
  const node = version?.graph.nodes.find((n) => n.id === sel);
  const myDraft = p?.versions.find((v) => v.status === "draft" && v.created_by_koc_id === kocId);

  return (
    <div className="page wide">
      <PageHead title={t("pws.title")} lead={t("pws.sub")}
        right={p && (myDraft ? <Link to={`/koc/pathway-versions/${myDraft.id}/edit`} className="btn">{t("pws.continue")} v{myDraft.version}</Link> :
          <button className="primary" disabled={busy || !kocId} title={!kocId ? t("koc.pickCentre") : undefined} onClick={() => run(() => api.post<{ version_id: number }>(`/api/pathways/${p.id}/drafts`, { koc_id: kocId }), "✓", (r) => nav(`/koc/pathway-versions/${r.version_id}/edit`))}>{t("pws.propose")}</button>)} />
      <div className="row wrap" style={{ gap: 8 }}>
        {(pathways ?? []).map((x) => (
          <button key={x.id} className={x.id === p?.id ? "primary" : ""} onClick={() => { setPid(x.id); setSel(null); }}>
            {pick(x.name, x.name_en)}
          </button>
        ))}
      </div>
      {p && version && (
        <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
          <div className="col" style={{ gap: 8 }}>
            <div className="spread"><h2>{pick(p.name, p.name_en)} <span className="muted">v{version.version}</span></h2><FlowLegend plain /></div>
            <PathwayFlow graph={version.graph} plain selectedId={sel} onSelect={setSel} height={820} />
          </div>
          <div className="col" style={{ gap: 14 }}>
            {node && (
              <section className="block">
                <h3>{pick(node.label, node.label_en)}</h3>
                <table className="small" style={{ marginTop: 6 }}><tbody>
                  <tr><td className="muted">type</td><td>{node.type} · {node.phase}</td></tr>
                  <tr><td className="muted">{t("pw.owner")}</td><td>{node.owner_role}</td></tr>
                  <tr><td className="muted">SLA</td><td>{node.sla_days ?? 0} d</td></tr>
                  {!!node.requires?.length && <tr><td className="muted">{t("pw.requires")}</td><td className="mono">{node.requires.map((r) => JSON.stringify(r)).join(" ")}</td></tr>}
                  {!!node.branches?.length && <tr><td className="muted">{t("kind.decision")}</td><td>{node.branches.map((b) => pick(b.label, b.label_en)).join(" / ")}{node.multi ? " (multi)" : ""}</td></tr>}
                  {node.description && <tr><td className="muted">·</td><td>{node.description}</td></tr>}
                </tbody></table>
              </section>
            )}
            <section className="block">
              <h3>{t("pws.versions")}</h3>
              <table className="small" style={{ marginTop: 6 }}><tbody>
                {[...p.versions].reverse().map((v) => (
                  <tr key={v.id} style={{ cursor: "pointer", background: v.id === vid ? "var(--hover)" : undefined }} onClick={() => setVid(v.id)}>
                    <td><b>v{v.version}</b></td><td><Tag color={STATUS_COLOR[v.status]}>{v.status}</Tag></td>
                    <td className="muted">{v.created_by_koc_id ? kocs.find((k) => k.id === v.created_by_koc_id)?.code : "seed"}</td>
                    <td className="muted">{fmtDate(v.activated_at ?? v.created_at)}</td>
                  </tr>
                ))}
              </tbody></table>
              <div className="xs muted" style={{ marginTop: 8 }}>{t("pws.running")}</div>
            </section>
            <section className="small"><div className="section-title">{t("pws.source")}</div><div className="muted" style={{ marginTop: 4 }}>{p.guideline_source}</div></section>
          </div>
        </div>
      )}
    </div>
  );
}
