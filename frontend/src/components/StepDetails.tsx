import { fmtDate } from "../api";
import { useApp } from "../ctx";
import type { PathwayNode } from "../types";
import { Icon } from "./Icon";
import { FormatChips } from "./Requirements";
import { Tag } from "./ui";

/**
 * The opened view of a pathway step. The canvas shows only the title; here come what the step needs (the same text the
 * LLM gets with the title when it checks an uploaded document), why the step is in the pathway, which files count and
 * whether it holds up the MDT. Inside a case it also shows whether a parsed document already satisfies it.
 */
export function StepDetails({ node, inCase = false }: { node: PathwayNode; inCase?: boolean }) {
  const { t, pick } = useApp();
  const evidence = node.completion === "evidence";
  const needs = pick(node.description, node.description_en);
  const why = pick(node.why, node.why_en);
  const matched = node.doc_status === "have" || node.doc_status === "conflict";
  return (
    <div className="step-details">
      <div className="row wrap" style={{ gap: 6 }}>
        <Tag color={node.blocking === false ? "gray" : "blue"}>{node.blocking === false ? t("sd.optional") : t("sd.required")}</Tag>
        {evidence && inCase && node.doc_status && (
          <Tag color={matched ? "green" : node.doc_status === "missing" ? "red" : "gray"}>
            {matched ? `✓ ${t("sd.matched")}` : t(`doc.${node.doc_status}`)}
          </Tag>
        )}
      </div>
      {needs && (
        <div>
          <div className="section-title">{evidence ? t("sd.needs") : t("ed.description")}</div>
          <div className="small">{needs}</div>
        </div>
      )}
      {why && (
        <div>
          <div className="section-title">{t("sd.why")}</div>
          <div className="small muted">{why}</div>
        </div>
      )}
      {evidence && (
        <div>
          <div className="section-title">{t("ed.formats")}</div>
          <FormatChips value={node.accepted_formats} />
        </div>
      )}
      {evidence && inCase && node.doc_status !== "skipped" && (
        <div>
          <div className="section-title">{t("sd.evidence")}</div>
          {node.evidence?.length ? node.evidence.map((e, i) => (
            <div key={i} className="small step-ev">
              <Icon name="check" />
              <a href={`/api/documents/${e.doc_id}/raw`} target="_blank" rel="noreferrer">{e.title}</a>
              <span className="muted">· {fmtDate(e.date)}</span>
            </div>
          )) : <div className="xs muted">{t("pw.notParsed")}</div>}
        </div>
      )}
    </div>
  );
}
