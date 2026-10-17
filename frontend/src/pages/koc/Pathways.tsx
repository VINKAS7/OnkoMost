import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate } from "../../api";
import { Icon } from "../../components/Icon";
import { FlowLegend, nodeKind, PathwayFlow } from "../../components/PathwayFlow";
import { Requirements } from "../../components/Requirements";
import { StepDetails } from "../../components/StepDetails";
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
  const [creating, setCreating] = useState(false);
  const { run, busy } = useAction();
  const nav = useNavigate();
  // a new cancer type with no active version yet shows only while it's being voted on, or to the KOC drafting it
  const shown = (pathways ?? []).filter((x) => x.active_version_id
    || x.versions.some((v) => v.status === "voting" || (v.status === "draft" && v.created_by_koc_id === kocId)));
  const p = shown.find((x) => x.id === pid) ?? shown[0];
  useEffect(() => { if (p) setVid(p.active_version_id ?? p.versions[0]?.id ?? null); }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: version } = useFetch<PathwayVersion>(vid ? `/api/pathway-versions/${vid}` : null);
  const node = version?.graph.nodes.find((n) => n.id === sel);
  const myDraft = p?.versions.find((v) => v.status === "draft" && v.created_by_koc_id === kocId);

  return (
    <div className="page wide">
      <PageHead title={t("pws.title")} lead={t("pws.sub")}
        right={
          <div className="row" style={{ gap: 8 }}>
            <button disabled={busy || !kocId} aria-expanded={creating} title={!kocId ? t("koc.pickCentre") : undefined} onClick={() => setCreating(!creating)}>
              <Icon name="plus" />{t("pws.proposeNew")}</button>
            {p && (myDraft ? <Link to={`/koc/pathway-versions/${myDraft.id}/edit`} className="btn primary">{t("pws.continue")} v{myDraft.version}</Link>
              : p.active_version_id && <button className="primary" disabled={busy || !kocId} title={!kocId ? t("koc.pickCentre") : undefined} onClick={() => run(() => api.post<{ version_id: number }>(`/api/pathways/${p.id}/drafts`, { koc_id: kocId }), "✓", (r) => nav(`/koc/pathway-versions/${r.version_id}/edit`))}>{t("pws.propose")}</button>)}
          </div>} />
      {creating && <NewPathwayForm onCancel={() => setCreating(false)} />}
      <div className="tabs" role="tablist">
        {shown.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === p?.id} className={x.id === p?.id ? "active" : ""} onClick={() => { setPid(x.id); setSel(null); }}>
            {pick(x.name, x.name_en)}
            {!x.active_version_id && <Tag color="blue">{t("pws.new")}</Tag>}
          </button>
        ))}
      </div>
      {p && version && (
        <div className="window">
          <div className="window-bar">
            <div className="crumbs">
              <span>{pick(p.name, p.name_en)}</span>
              <Icon name="chevron" />
              <span className="muted" style={{ fontWeight: 500 }}>v{version.version}</span>
            </div>
            <Tag color={STATUS_COLOR[version.status]}>{version.status}</Tag>
            <div className="right"><FlowLegend plain /></div>
          </div>
          <div className="window-split">
            <PathwayFlow graph={version.graph} plain framed={false} selectedId={sel} onSelect={setSel} height={780} />
            <aside className="window-side">
              <div className="window-panel">
                {node ? (() => {
                  const kind = nodeKind(node);
                  return (
                    <>
                      <div className="panel-head">
                        <span className="kic"><Icon name={kind.icon} /></span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="xs muted">{t(kind.key)} · <span className="mono">{node.id}</span></div>
                          <h3>{pick(node.label, node.label_en)}</h3>
                        </div>
                        <button className="ghost icon" aria-label="close" onClick={() => setSel(null)}><Icon name="x" /></button>
                      </div>
                      <div className="panel-body">
                        <div className="card">
                          <table className="small"><tbody>
                            <tr><td className="muted">type</td><td>{node.type} · {node.phase}</td></tr>
                            <tr><td className="muted">{t("pw.owner")}</td><td>{node.owner_role}</td></tr>
                            <tr><td className="muted">SLA</td><td>{node.sla_days ?? 0} d</td></tr>
                            {!!node.branches?.length && <tr><td className="muted">{t("kind.decision")}</td><td>{node.branches.map((b) => pick(b.label, b.label_en)).join(" / ")}{node.multi ? " (multi)" : ""}</td></tr>}
                          </tbody></table>
                        </div>
                        <StepDetails node={node} />
                        {node.completion === "evidence" && (
                          <>
                            <div className="section-title" style={{ marginBottom: -6 }}>{t("ed.when")}</div>
                            <Requirements value={node.requires ?? []} />
                          </>
                        )}
                      </div>
                    </>
                  );
                })() : (
                  <>
                    <div className="panel-head">
                      <span className="kic"><Icon name="layers" /></span>
                      <h3 className="grow">{t("pws.versions")}</h3>
                    </div>
                    <div className="panel-body">
                      <div className="card">
                        <table className="small"><tbody>
                          {[...p.versions].reverse().map((v) => (
                            <tr key={v.id} style={{ cursor: "pointer", background: v.id === vid ? "var(--accent-soft)" : undefined }} onClick={() => setVid(v.id)}>
                              <td><b>v{v.version}</b></td><td><Tag color={STATUS_COLOR[v.status]}>{v.status}</Tag></td>
                              <td className="muted">{v.created_by_koc_id ? kocs.find((k) => k.id === v.created_by_koc_id)?.code : "seed"}</td>
                              <td className="muted">{fmtDate(v.activated_at ?? v.created_at)}</td>
                            </tr>
                          ))}
                        </tbody></table>
                      </div>
                      <div className="xs muted">{t("pws.running")}</div>
                      <div>
                        <div className="section-title">{t("pws.icd")}</div>
                        <div className="row wrap" style={{ gap: 6 }}>{p.icd_codes.map((c) => <span key={c} className="vchip mono">{c}</span>)}</div>
                      </div>
                      {p.guideline_source && (
                        <div>
                          <div className="section-title">{t("pws.source")}</div>
                          <div className="small muted">{p.guideline_source}</div>
                        </div>
                      )}
                      <div className="panel-empty" style={{ padding: "24px 12px" }}><Icon name="pointer" /><div className="small">{t("ed.pick")}</div></div>
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}

/** A new cancer type: names + ICD-10 codes (referrals are routed by them); the steps are drawn in the editor next. */
function NewPathwayForm({ onCancel }: { onCancel: () => void }) {
  const { kocId, t } = useApp();
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [icd, setIcd] = useState("");
  const [source, setSource] = useState("");
  const create = () => run(() => api.post<{ version_id: number }>("/api/pathways", { koc_id: kocId, name, name_en: nameEn, icd_codes: icd, guideline_source: source }),
    "✓", (r) => nav(`/koc/pathway-versions/${r.version_id}/edit`));
  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card-head"><span className="kic-lg"><Icon name="plus" /></span><h3 className="grow">{t("np.title")}</h3>
        <button className="ghost icon" aria-label="close" onClick={onCancel}><Icon name="x" /></button></div>
      <div className="card-body col" style={{ gap: 14 }}>
        <div className="xs muted">{t("np.sub")}</div>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <label className="field grow">{t("np.name")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("np.eg")} Karcinom prostaty`} /></label>
          <label className="field grow">{t("np.nameEn")}<input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder={`${t("np.eg")} Prostate cancer`} /></label>
          <label className="field" style={{ width: 200 }}>{t("np.icd")}<input value={icd} onChange={(e) => setIcd(e.target.value)} placeholder={`${t("np.eg")} C61`} className="mono" /></label>
        </div>
        <div className="xs muted" style={{ marginTop: -8 }}>{t("np.icdHint")}</div>
        <label className="field">{t("pws.source")}<input value={source} onChange={(e) => setSource(e.target.value)} placeholder={t("np.sourceHint")} /></label>
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" disabled={busy || !(name.trim() || nameEn.trim()) || !icd.trim()} onClick={create}><Icon name="arrow" />{t("np.create")}</button>
          <button className="ghost" onClick={onCancel}>{t("np.cancel")}</button>
        </div>
      </div>
    </section>
  );
}
