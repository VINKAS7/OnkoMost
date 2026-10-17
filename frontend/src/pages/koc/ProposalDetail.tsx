import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate } from "../../api";
import { PathwayFlow } from "../../components/PathwayFlow";
import { Callout, PageHead, Tag } from "../../components/ui";
import { useAction, useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { Proposal } from "../../types";
import { PROPOSAL_COLOR, proposalWhat, Tally } from "./Proposals";

export default function ProposalDetail() {
  const { id } = useParams();
  const { kocId, koc, kocs, t, pick } = useApp();
  const { data: p, reload } = useFetch<Proposal>(`/api/proposals/${id}`);
  const [comment, setComment] = useState("");
  const { run, busy } = useAction();
  if (!p) return <div className="page muted">{t("common.loading")}</div>;
  const marks: Record<string, "added" | "changed"> = {};
  if (!p.new_pathway) { // in a new pathway every step is new – outlining all of them says nothing
    p.diff.added_nodes.forEach((n) => (marks[n] = "added"));
    p.diff.changed_nodes.forEach((n) => (marks[n.id] = "changed"));
  }
  const mine = p.votes.find((v) => v.koc_id === kocId);
  // the change list names steps by their label, not their internal id
  const step = (nid: string) => {
    const n = p.draft_graph.nodes.find((x) => x.id === nid) ?? p.base_graph.nodes.find((x) => x.id === nid);
    return n ? pick(n.label, n.label_en) : nid;
  };
  const edge = (e: string) => e.split("->").map(step).join(" → ");
  const vote = (choice: string) => run(() => api.post(`/api/proposals/${p.id}/votes`, { koc_id: kocId, choice, comment }), `${koc?.code}: ${choice}`, reload);
  return (
    <div className="page wide">
      <PageHead title={p.title} lead={`${pick(p.pathway, p.pathway_en)} · ${proposalWhat(p, t)} · ${p.author} · ${fmtDate(p.deadline)}`}
        right={<Tag color={PROPOSAL_COLOR[p.status]}>{p.status}</Tag>} />
      {p.status === "accepted" && <Callout color="green">{t("pr.accepted")}</Callout>}
      {p.status === "rejected" && <Callout color="red">{t("pr.rejected")}</Callout>}
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <div className="col" style={{ gap: 8 }}>
          {!p.new_pathway && <div className="legend"><span><i style={{ outline: "2px solid var(--green)" }} /> added</span><span><i style={{ outline: "2px solid var(--yellow)" }} /> changed</span></div>}
          <PathwayFlow graph={p.draft_graph} plain marks={marks} height={820} />
        </div>
        <div className="col" style={{ gap: 14 }}>
          <section className="block col">
            <h3>{t("pr.votes")}</h3>
            <Tally tl={p.tally} />
            {p.status === "voting" && !kocId && <div className="small muted">{t("koc.pickCentre")}</div>}
            {p.status === "voting" && !!kocId && (
              <div className="col" style={{ marginTop: 6 }}>
                <div className="small">{t("pr.as")} <b>{koc?.name}</b>{mine && <> · <Tag>{mine.choice}</Tag></>}</div>
                <div className="xs muted">{t("pr.switch")}</div>
                <input placeholder="…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <div className="row">
                  <button className="primary" disabled={busy} onClick={() => vote("yes")}>{t("pr.yes")}</button>
                  <button className="danger" disabled={busy} onClick={() => vote("no")}>{t("pr.no")}</button>
                  <button disabled={busy} onClick={() => vote("abstain")}>{t("pr.abstain")}</button>
                </div>
              </div>
            )}
            <table className="small" style={{ marginTop: 6 }}><tbody>
              {kocs.map((k) => {
                const v = p.votes.find((x) => x.koc_id === k.id);
                return <tr key={k.id}><td>{k.name}</td><td>{v ? <Tag color={v.choice === "yes" ? "green" : v.choice === "no" ? "red" : "gray"}>{t(`pr.${v.choice}`)}</Tag> : <span className="faint">—</span>}</td><td className="muted">{v?.comment}</td></tr>;
              })}
            </tbody></table>
          </section>
          <section className="block"><h3>{t("pr.rationale")}</h3><div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{p.rationale}</div></section>
          {p.new_pathway ? (
            <section className="block small">
              <h3>{t("ed.newType")}</h3>
              <div style={{ marginTop: 6 }}>{t("pws.icd")}: <span className="mono">{(p.icd_codes ?? []).join(", ")}</span></div>
              <div className="muted">{p.draft_graph.nodes.length} {t("pr.steps")}</div>
            </section>
          ) : (
          <section className="block small">
            <h3>{t("pr.changes")}</h3>
            <ul style={{ paddingLeft: 18, margin: "6px 0 0", lineHeight: 1.7 }}>
              {p.diff.added_nodes.map((n) => <li key={n}>+ <b>{step(n)}</b></li>)}
              {p.diff.removed_nodes.map((n) => <li key={n}>− <b>{step(n)}</b></li>)}
              {p.diff.changed_nodes.map((n) => <li key={n.id}>~ <b>{step(n.id)}</b>: <span className="muted">{n.fields.join(", ")}</span></li>)}
              {p.diff.added_edges.map((e) => <li key={e}>+ {edge(e)}</li>)}
              {p.diff.removed_edges.map((e) => <li key={e}>− {edge(e)}</li>)}
            </ul>
          </section>
          )}
        </div>
      </div>
    </div>
  );
}
