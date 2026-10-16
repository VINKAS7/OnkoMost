import { useRef, useState } from "react";
import { api, fmtDate } from "../../../api";
import { FlowLegend, PathwayFlow } from "../../../components/PathwayFlow";
import { DOC_COLOR, Due, Empty } from "../../../components/ui";
import { useAction, useApp } from "../../../ctx";
import type { CaseDetail, PathwayNode, Task } from "../../../types";
import Messages, { type MessagesHandle } from "./Messages";

const KIND_COLOR: Record<string, string> = {
  mismatch: "yellow", missing_document: "red", missing_field: "red", decision: "purple", to_schedule: "blue", action: "blue",
  question: "orange",
};

function TaskRow({ task, c, reload, go, msgs }: { task: Task; c: CaseDetail; reload: () => void; go: (tab: string) => void; msgs?: React.RefObject<MessagesHandle> }) {
  const { actor, t, pick, lang } = useApp();
  const { run, busy } = useAction();
  const [form, setForm] = useState<null | "schedule" | "review">(null);
  const [on, setOn] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const open = task.status === "open" || task.status === "scheduled";
  const finding = c.findings.find((f) => f.key === task.key);
  const node = c.pathway_graph.nodes.find((n) => n.id === task.node_id);

  let action: React.ReactNode = null;
  if (open) {
    if (task.key === "step:triage") action = <button className="primary sm" disabled={busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/accept`, { by: actor }), "✓", reload)}>{t("act.accept")}</button>;
    else if (task.kind === "missing_document" && !task.external) action = <button className="sm" disabled={busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/doc-requests`, { finding_key: task.key, by: actor }), "✓", reload)}>{t("act.request")}</button>;
    else if (task.kind === "missing_document") action = <button className="sm ghost" onClick={() => go("documents")}>{t("act.upload")}</button>;
    else if (task.kind === "to_schedule") action = <button className="sm" onClick={() => setForm(form === "schedule" ? null : "schedule")}>{task.status === "scheduled" ? t("act.rebook") : t("act.book")}</button>;
    else if (task.kind === "mismatch") action = <button className="sm" onClick={() => setForm(form === "review" ? null : "review")}>{t("act.review")}</button>;
    else if (task.kind === "missing_field") action = <span className="row"><button className="sm" onClick={() => msgs?.current?.askGp()}>{t("msg.askGp")}</button><button className="sm ghost" onClick={() => go("handover")}>{t("act.fill")}</button></span>;
    else if (task.kind === "question" && !task.external) action = <button className="primary sm" onClick={() => msgs?.current?.reply("review", Number(task.key.split(":")[1]))}>{t("msg.reply")}</button>;
    else if (task.node_id === "handover") action = <button className="primary sm" onClick={() => go("handover")}>{t("act.openHandover")}</button>;
    else if (["mdt", "decision", "feedback", "handover_k2"].includes(task.node_id)) action = <button className="sm" onClick={() => go("result")}>{t("act.openResult")}</button>;
    else if (node?.completion === "manual") action = <button className="sm" disabled={busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/steps/${task.node_id}/complete`, { by: actor }), "✓", reload)}>{lang === "cs" && node.action ? node.action : t("act.done")}</button>;
  }
  return (
    <div className={`item ${open ? "" : "done"}`} style={{ alignItems: "baseline" }}>
      <span className={`dot ${open ? KIND_COLOR[task.kind] ?? "gray" : "gray"}`} />
      <div className="grow">
        <div className="title" style={{ fontWeight: 550 }}>{pick(task.title, task.title_en)}</div>
        {(task.kind === "mismatch" || task.kind === "question") && <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{pick(task.detail, task.detail_en).slice(0, 240)}</div>}
        <div className="meta">
          <span>{task.owner_name}</span>
          {open && <Due task={task} />}
          {!open && <span>{task.resolution}</span>}
          {finding?.doc_id && <a href={`/api/documents/${finding.doc_id}/raw`}>{t("act.sourceDoc")}</a>}
        </div>
        {form === "schedule" && (
          <div className="row wrap" style={{ marginTop: 8 }}>
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
            <input placeholder={t("act.place")} value={place} onChange={(e) => setPlace(e.target.value)} style={{ minWidth: 200 }} />
            <button className="primary sm" disabled={!on || busy} onClick={() => run(() => api.post(`/api/tasks/${task.id}/schedule`, { on, place, by: actor }), "✓", () => { setForm(null); reload(); })}>{t("act.save")}</button>
          </div>
        )}
        {form === "review" && (
          <div className="col" style={{ marginTop: 8 }}>
            <textarea placeholder={t("act.reviewNote")} value={note} onChange={(e) => setNote(e.target.value)} />
            <div><button className="primary sm" disabled={!note || busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/flags/review`, { flag_key: task.key, note, by: actor }), "✓", reload)}>{t("act.save")}</button></div>
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

function DecisionBlock({ node, c, reload }: { node: PathwayNode; c: CaseDetail; reload: () => void }) {
  const { t, pick, actor } = useApp();
  const { run, busy } = useAction();
  const [keys, setKeys] = useState<string[]>([]);
  return (
    <section className="col" style={{ gap: 8 }}>
      <div className="section-title">{pick(node.label, node.label_en)}</div>
      <div className="row wrap">
        {node.branches?.map((b) => (
          <button key={b.key} className={`sm ${keys.includes(b.key) ? "primary" : ""}`}
            onClick={() => setKeys(node.multi ? (keys.includes(b.key) ? keys.filter((k) => k !== b.key) : [...keys, b.key]) : [b.key])}>
            {pick(b.label, b.label_en)}
          </button>
        ))}
        <button className="sm ghost" disabled={!keys.length || busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/decisions`, { node_id: node.id, keys, by: actor }), t("pw.decided"), reload)}>{t("pw.decide")} →</button>
      </div>
    </section>
  );
}

export default function PathwayTab({ c, reload, go }: { c: CaseDetail; reload: () => void; go: (tab: string) => void }) {
  const { t, pick } = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const msgs = useRef<MessagesHandle>(null);
  const nodes = c.pathway_graph.nodes;
  const node = nodes.find((n) => n.id === sel);
  const evidence = nodes.filter((n) => n.completion === "evidence" && n.doc_status !== "skipped");
  const decisions = nodes.filter((n) => n.type === "decision" && n.status === "available" && n.id !== "decision");
  const open = c.tasks.filter((x) => x.status === "open" || x.status === "scheduled");
  const mine = open.filter((x) => !x.external), others = open.filter((x) => x.external);
  const done = c.tasks.filter((x) => x.status === "done" || x.status === "dismissed");

  return (
    <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(320px, 1fr)", gap: 28 }}>
      <div className="col" style={{ gap: 10 }}>
        <FlowLegend />
        <PathwayFlow graph={c.pathway_graph} selectedId={sel} onSelect={setSel} height={700} />
        {node && (
          <div className="block">
            <div className="spread"><b>{pick(node.label, node.label_en)}</b>{node.doc_status && <span className="st"><span className={`dot ${DOC_COLOR[node.doc_status]}`} />{t(`doc.${node.doc_status}`)}</span>}</div>
            <div className="meta" style={{ marginTop: 2 }}>
              <span>{node.owner_name}</span>
              {node.done_on ? <span>{t("pw.doneOn")} {fmtDate(node.done_on)}</span> : node.due_on && <span>{t("pw.due")} {fmtDate(node.due_on)}</span>}
            </div>
            {node.conflicts?.map((x) => <div key={x.key} className="small" style={{ marginTop: 6, color: "var(--yellow)" }}>{pick(x.message, x.message_en)}{x.reviewed && " ✓"}</div>)}
            {node.evidence?.map((e, i) => <div key={i} className="small" style={{ marginTop: 4 }}><a href={`/api/documents/${e.doc_id}/raw`}>{e.title}</a> <span className="muted">· {fmtDate(e.date)}</span></div>)}
          </div>
        )}
      </div>

      <div className="col" style={{ gap: 26 }}>
        <section>
          <div className="section-title">{t("pw.checklist")}</div>
          {evidence.map((n) => (
            <div key={n.id} className="check" onClick={() => setSel(n.id)}>
              <span className={`dot ${DOC_COLOR[n.doc_status ?? "missing"]}`} />
              <div>
                <div className="small" style={{ fontWeight: 550 }}>{pick(n.label, n.label_en)}{n.blocking === false && <span className="faint" style={{ fontWeight: 400 }}> · {t("pw.optional")}</span>}</div>
                {n.doc_status === "conflict" && <div className="xs" style={{ color: "var(--yellow)" }}>{t("doc.conflict")}</div>}
                {n.doc_status === "missing" && !!n.detail?.missing?.length && <div className="xs" style={{ color: "var(--red)" }}>{n.detail.missing.map((m) => m.label).join(", ")}</div>}
              </div>
              <span className="xs muted">{n.doc_status === "have" && n.evidence?.[0] ? fmtDate(n.evidence[0].date) : t(`doc.${n.doc_status ?? "missing"}`)}</span>
            </div>
          ))}
        </section>

        {decisions.map((n) => <DecisionBlock key={n.id} node={n} c={c} reload={reload} />)}

        <section>
          <div className="section-title">{t("pw.next")}</div>
          <div className="list">
            {mine.map((x) => <TaskRow key={x.id} task={x} c={c} reload={reload} go={go} msgs={msgs} />)}
            {!mine.length && <Empty>{t("pw.nothing")}</Empty>}
          </div>
          {others.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 18 }}>{t("pw.others")}</div>
              <div className="list">{others.map((x) => <TaskRow key={x.id} task={x} c={c} reload={reload} go={go} />)}</div>
            </>
          )}
          {done.length > 0 && <button className="linkbtn" style={{ marginTop: 12 }} onClick={() => setShowMore(!showMore)}>{showMore ? t("pw.hide") : `${t("pw.completed")} (${done.length})`}</button>}
          {showMore && <div className="list" style={{ marginTop: 6 }}>{done.map((x) => <TaskRow key={x.id} task={x} c={c} reload={reload} go={go} />)}</div>}
        </section>

        <Messages ref={msgs} c={c} reload={reload} />
      </div>
    </div>
  );
}
