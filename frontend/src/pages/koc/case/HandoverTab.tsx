import { useState } from "react";
import { api, fmtDate } from "../../../api";
import { Callout, SourceChips, Tag } from "../../../components/ui";
import { useAction, useApp } from "../../../ctx";
import { useFetch } from "../../../hooks";
import type { CaseDetail, Handover, HandoverField } from "../../../types";

function copy(text: string, toast: (m: string) => void) {
  navigator.clipboard?.writeText(text).then(() => toast("✓")).catch(() => toast("Clipboard blocked"));
}

function Field({ f, caseId, reload, doctor }: { f: HandoverField; caseId: number; reload: () => void; doctor: string }) {
  const { actor, toast, t, pick } = useApp();
  const { run, busy } = useAction();
  const [mode, setMode] = useState<null | "edit" | "add">(null);
  const [value, setValue] = useState("");
  const post = (kind: string, v = "") =>
    run(() => api.post(`/api/cases/${caseId}/handover/entries`, { field_key: f.key, kind, value: v, by: kind === "add" ? actor : doctor }),
      "✓", () => { setMode(null); setValue(""); reload(); });
  const label = pick(f.label, f.label_en);
  return (
    <div className={`hv-field ${f.status === "missing" ? "missing" : ""}`}>
      <div>
        <div className="label">{label}</div>
        <div className="row wrap" style={{ marginTop: 4, gap: 4 }}>
          {f.status === "missing" && <Tag color="red">{t("hv.missing")}</Tag>}
          {f.status === "unverified" && <Tag color="yellow">{t("hv.check")}</Tag>}
          {f.confirmed && <Tag color="green" title={f.confirmed_by ?? ""}>{t("hv.confirmed")}</Tag>}
        </div>
        {f.note && <div className="xs muted" style={{ marginTop: 4 }}>{pick(f.note, f.note_en)}</div>}
      </div>
      <div>
        {f.items.map((it, i) => (
          <div key={i} className="hv-item">
            {it.text}
            {it.added_by && <Tag color="blue">{t("hv.addedBy")} {it.added_by}</Tag>}
            {it.edited_by && <Tag color="blue">{t("hv.editedBy")} {it.edited_by}</Tag>}
            {!!it.sources.length && <div><SourceChips sources={it.sources} /></div>}
            {it.rows && (
              <details style={{ marginTop: 4 }}>
                <summary className="xs muted">{t("hv.allValues")} ({it.rows.length})</summary>
                <table className="small"><tbody>
                  {it.rows.map((r, j) => <tr key={j}><td>{r.analyte}</td><td><b style={{ color: r.flag ? "var(--red)" : undefined }}>{r.value} {r.flag}</b></td><td className="muted">{r.unit}</td><td className="muted">{r.ref}</td><td>{r.is_tumor_marker && <Tag color="blue">TM</Tag>}</td></tr>)}
                </tbody></table>
              </details>
            )}
          </div>
        ))}
        {!f.items.length && <div className="muted small">{t("hv.notFound")}</div>}
        {mode && (
          <div className="col" style={{ marginTop: 6 }}>
            <textarea value={value} onChange={(e) => setValue(e.target.value)} />
            <div className="row"><button className="primary sm" disabled={!value || busy} onClick={() => post(mode, value)}>{t("act.save")}</button><button className="sm ghost" onClick={() => setMode(null)}>{t("act.cancel")}</button></div>
          </div>
        )}
      </div>
      <div className="row wrap" style={{ justifyContent: "flex-end", gap: 2, maxWidth: 230 }}>
        {f.items.length > 0 && !f.confirmed && <button className="sm" disabled={busy} onClick={() => post("confirm")}>{t("hv.confirm")}</button>}
        {f.items.length > 0 && <button className="sm ghost" onClick={() => { setMode("edit"); setValue(f.text); }}>{t("hv.edit")}</button>}
        <button className="sm ghost" onClick={() => setMode("add")}>{f.items.length ? t("hv.add") : t("hv.fill")}</button>
        {f.items.length > 0 && <button className="sm ghost" title={t("hv.copy")} onClick={() => copy(`${label}: ${f.text}`, toast)}>{t("hv.copy")}</button>}
      </div>
    </div>
  );
}

export default function HandoverTab({ c, reload }: { c: CaseDetail; reload: () => void }) {
  const { toast, t, pick } = useApp();
  const { data: h, reload: reloadH } = useFetch<Handover>(`/api/cases/${c.id}/handover`);
  const { run, busy } = useAction();
  const [doctor, setDoctor] = useState("MUDr. Martin Svoboda");
  if (!h) return <div className="muted">{t("common.loading")}</div>;
  const both = () => { reloadH(); reload(); };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="spread wrap">
        <div>
          <h2>{t("hv.title")}</h2>
          <div className="small muted">{t("hv.asof")} {fmtDate(h.cutoff)} · {h.confirmed_count}/{h.field_count} {t("hv.confirmed")} · {t("hv.sub")}</div>
        </div>
        <div className="row wrap">
          <label className="row small muted">{t("hv.doctor")} <input value={doctor} onChange={(e) => setDoctor(e.target.value)} style={{ width: 190 }} /></label>
          <button className="sm" onClick={() => copy(h.text, toast)}>{t("hv.copyAll")}</button>
          {h.validated ? <Tag color="green">{t("hv.validated")}</Tag> :
            <button className="primary" disabled={busy} onClick={() => run(() => api.post(`/api/cases/${c.id}/handover/validate`, { by: doctor }), t("hv.validated"), both)}>{t("hv.validate")}</button>}
        </div>
      </div>
      {(h.missing.length > 0 || h.unverified.length > 0) && (
        <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {h.missing.length > 0 && <Callout color="red"><b>{t("hv.missing")}:</b> {h.missing.map((m) => pick(m.label, m.label_en)).join(", ")}</Callout>}
          {h.unverified.length > 0 && <Callout color="yellow"><b>{t("hv.check")}:</b> {h.unverified.map((m) => pick(m.label, m.label_en)).join(", ")}</Callout>}
        </div>
      )}
      {h.sections.map((s) => (
        <section key={s.key}>
          <div className="block-head" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
            <h3>{pick(s.label, s.label_en)}</h3>
            <button className="sm ghost" onClick={() => copy(`${s.label.toUpperCase()}\n` + s.fields.map((f) => `${f.label}: ${f.text || "—"}`).join("\n"), toast)}>{t("hv.copy")}</button>
          </div>
          {s.fields.map((f) => <Field key={f.key} f={f} caseId={c.id} reload={both} doctor={doctor} />)}
        </section>
      ))}
    </div>
  );
}
