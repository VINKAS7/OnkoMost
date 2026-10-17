import type { ReactNode } from "react";
import { useApp } from "../ctx";
import { expandFormats, FILE_FORMATS, formatHint, formatLabel } from "../formats";
import type { Requirement } from "../types";
import { Icon } from "./Icon";

type Opt = Record<string, [string, string]>; // value → [cs, en]

const EXAMS: Opt = {
  ct: ["CT", "CT"], pet_ct: ["PET/CT", "PET/CT"], mri: ["MR", "MRI"], xray: ["RTG", "X-ray"], ultrasound: ["Ultrazvuk", "Ultrasound"],
  histology: ["Histologie", "Histology"], bronchoscopy: ["Bronchoskopie", "Bronchoscopy"], eus_fnb: ["EUS-FNB", "EUS-FNB"],
  colonoscopy: ["Kolonoskopie", "Colonoscopy"], mammography: ["Mamografie", "Mammography"], lab: ["Laboratoř", "Lab"],
  pain_consult: ["Algeziologie", "Pain clinic"], psych_consult: ["Psychologie", "Psychology"], specialist_visit: ["Odborné vyšetření", "Specialist visit"],
};
const DOCS: Opt = {
  referral: ["Žádost o převzetí", "Referral"], mdt_conclusion: ["Závěr MDT", "MDT conclusion"], histology: ["Histologie", "Histology"],
  procedure: ["Výkon", "Procedure"], lab: ["Laboratoř", "Lab"], imaging: ["Zobrazovací vyšetření", "Imaging"], gp_summary: ["Výpis PL", "GP summary"],
  pain_report: ["Zpráva algeziologa", "Pain report"], psychology_report: ["Zpráva psychologa", "Psychology report"],
  specialist_report: ["Zpráva specialisty", "Specialist report"], other: ["Jiný", "Other"],
};
const DIAGNOSIS: Opt = { confirmed: ["Potvrzená", "Confirmed"], suspected: ["Suspektní", "Suspected"], stated: ["Uvedená", "Stated"] };
const PRECAUTIONS: Opt = { anticoagulant_paused: ["Vysazená antikoagulace", "Anticoagulant paused"] };

const KINDS = ["document", "exam", "lab", "diagnosis", "precaution", "mentioned_exams_received", "described"];
const DEFAULTS: Record<string, Requirement> = {
  document: { kind: "document", doc_type: "referral" }, exam: { kind: "exam", exam_type: "ct" },
  lab: { kind: "lab", analyte: "CEA", max_age_days: 30 }, diagnosis: { kind: "diagnosis", status: "confirmed" },
  precaution: { kind: "precaution", precaution: "anticoagulant_paused" }, mentioned_exams_received: { kind: "mentioned_exams_received" },
  described: { kind: "described" },
};
const KIND_ICON: Record<string, string> = { document: "file", exam: "layers", lab: "filter", diagnosis: "stethoscope", precaution: "pointer", mentioned_exams_received: "inbox", described: "file" };

export const newRequirement = (): Requirement => ({ ...DEFAULTS.document });

/** One value: a chip when read-only, otherwise a borderless select. */
function Value({ opts, value, onChange }: { opts: Opt; value: string; onChange?: (v: string) => void }) {
  const { pick } = useApp();
  const label = (v: string) => (opts[v] ? pick(opts[v][0], opts[v][1]) : v);
  if (!onChange) return <span className="vchip">{label(value)}</span>;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!opts[value] && <option value={value}>{value}</option>}
      {Object.keys(opts).map((k) => <option key={k} value={k}>{label(k)}</option>)}
    </select>
  );
}

function Cond({ req, onChange, onRemove }: { req: Requirement; onChange?: (r: Requirement) => void; onRemove?: () => void }) {
  const { t, pick } = useApp();
  const set = onChange ? (patch: Record<string, unknown>) => onChange({ ...req, ...patch }) : undefined;
  const exams = Array.isArray(req.exam_type) ? (req.exam_type as string[]) : null;
  let rows: [string, ReactNode][];
  switch (req.kind) {
    case "document": rows = [[t("cb.is"), <Value opts={DOCS} value={String(req.doc_type ?? "")} onChange={set && ((v) => set({ doc_type: v }))} />]]; break;
    case "exam":
      rows = [[exams ? t("cb.isAny") : t("cb.is"), exams ? (
        <>
          {exams.map((x) => (
            <span key={x} className="vchip">{EXAMS[x] ? pick(EXAMS[x][0], EXAMS[x][1]) : x}
              {set && <button aria-label="remove" onClick={() => { const rest = exams.filter((y) => y !== x); set({ exam_type: rest.length === 1 ? rest[0] : rest }); }}><Icon name="x" /></button>}
            </span>
          ))}
          {set && <AddValue opts={EXAMS} taken={exams} onAdd={(v) => set({ exam_type: [...exams, v] })} />}
        </>
      ) : (
        <>
          <Value opts={EXAMS} value={String(req.exam_type ?? "")} onChange={set && ((v) => set({ exam_type: v }))} />
          {set && <AddValue opts={EXAMS} taken={[String(req.exam_type)]} onAdd={(v) => set({ exam_type: [String(req.exam_type), v] })} or />}
        </>
      )]];
      break;
    case "lab":
      rows = [
        [t("cb.is"), set ? <input value={String(req.analyte ?? "")} onChange={(e) => set({ analyte: e.target.value })} style={{ width: "100%" }} /> : <span className="vchip">{String(req.analyte)}</span>],
        [t("cb.within"), set ? <input type="number" min={1} value={Number(req.max_age_days ?? 30)} onChange={(e) => set({ max_age_days: Number(e.target.value) })} /> : <span className="vchip">{String(req.max_age_days ?? "—")}</span>],
      ];
      break;
    case "diagnosis": rows = [[t("cb.is"), <Value opts={DIAGNOSIS} value={String(req.status ?? "")} onChange={set && ((v) => set({ status: v }))} />]]; break;
    case "precaution": rows = [[t("cb.is"), <Value opts={PRECAUTIONS} value={String(req.precaution ?? "")} onChange={set && ((v) => set({ precaution: v }))} />]]; break;
    case "mentioned_exams_received": rows = [[t("cb.is"), <span className="vchip">{t("cb.received")}</span>]]; break;
    case "described": rows = [[t("cb.is"), <span className="vchip">{t("cb.described")}</span>]]; break;
    default: {
      const { kind: _k, ...rest } = req;
      rows = [[t("cb.is"), <span className="vchip mono">{Object.keys(rest).length ? JSON.stringify(rest) : "✓"}</span>]];
    }
  }
  return (
    <div className="cond">
      <div className="cond-head">
        <span className="cond-ic"><Icon name={KIND_ICON[req.kind] ?? "file"} /></span>
        {onChange ? (
          <select value={req.kind} onChange={(e) => onChange({ ...(DEFAULTS[e.target.value] ?? { kind: e.target.value }) })}>
            {!KINDS.includes(req.kind) && <option value={req.kind}>{req.kind}</option>}
            {KINDS.map((k) => <option key={k} value={k}>{t(`cb.f.${k}`)}</option>)}
          </select>
        ) : <span className="grow" style={{ fontWeight: 550, padding: "6px 4px" }}>{KINDS.includes(req.kind) ? t(`cb.f.${req.kind}`) : req.kind}</span>}
        {onRemove && <button className="ghost icon" aria-label="remove" onClick={onRemove}><Icon name="x" /></button>}
      </div>
      {rows.map(([op, val], i) => (
        <div key={i} className="cond-row"><div>{op}</div><div className="cond-vals">{val}</div></div>
      ))}
    </div>
  );
}

function AddValue({ opts, taken, onAdd, or }: { opts: Opt; taken: string[]; onAdd: (v: string) => void; or?: boolean }) {
  const { t, pick } = useApp();
  const free = Object.keys(opts).filter((k) => !taken.includes(k));
  if (!free.length) return null;
  return (
    <select value="" onChange={(e) => e.target.value && onAdd(e.target.value)} style={{ color: "var(--muted)", width: "auto" }} aria-label={t("cb.pick")}>
      <option value="">{or ? `+ ${t("cb.any").toLowerCase()}…` : t("cb.pick")}</option>
      {free.map((k) => <option key={k} value={k}>{pick(opts[k][0], opts[k][1])}</option>)}
    </select>
  );
}

/** The "completed when" builder: every requirement must hold; a list of exams inside one means any of them. */
export function Requirements({ value, onChange, title }: { value: Requirement[]; onChange?: (r: Requirement[]) => void; title?: string }) {
  const { t } = useApp();
  // "described" is the title + description + formats above – don't show a second jargon card
  const shown = value.map((r, i) => [r, i] as const).filter(([r]) => r.kind !== "described");
  const setAt = (i: number) => onChange && ((r: Requirement) => onChange(value.map((x, j) => (j === i ? r : x))));
  const removeAt = (i: number) => onChange && (() => onChange(value.filter((_, j) => j !== i)));
  if (!shown.length && !onChange) return null;
  return (
    <div className="cgroup">
      <div className="cgroup-head">
        <span className="cbadge">{t("cb.all")}</span>
        {title ?? t("cb.matchAll")}
      </div>
      {!shown.length && <div className="muted small">{t("cb.none")}</div>}
      {shown.map(([r, i]) =>
        r.kind === "exam" && Array.isArray(r.exam_type) && r.exam_type.length > 1 ? (
          <div key={i} className="cgroup or">
            <div className="cgroup-head"><span className="cbadge or">{t("cb.any")}</span>{t("cb.matchAny")}</div>
            <Cond req={r} onChange={setAt(i)} onRemove={removeAt(i)} />
          </div>
        ) : <Cond key={i} req={r} onChange={setAt(i)} onRemove={removeAt(i)} />,
      )}
      {onChange && (
        <button className="add-cond" onClick={() => onChange([...value, newRequirement()])}><Icon name="plus" />{t("cb.add")}</button>
      )}
    </div>
  );
}

/** Allowed file formats for a document step – several values mean OR. */
export function FormatChips({ value }: { value?: string[] }) {
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {expandFormats(value).map((k) => (
        <span key={k} className="vchip mono" title={formatHint(k)}>{formatLabel(k)}</span>
      ))}
    </div>
  );
}

export function FormatPicker({ value, onChange }: { value: string[]; onChange?: (v: string[]) => void }) {
  const { t } = useApp();
  const keys = expandFormats(value?.length ? value : undefined);
  const allOn = !value?.length || value.includes("any");
  const toggle = (id: string) => {
    if (!onChange) return;
    if (allOn) onChange(FILE_FORMATS.map((f) => f.id).filter((k) => k !== id));
    else {
      const next = keys.includes(id) ? keys.filter((k) => k !== id) : [...keys, id];
      onChange(next.length === FILE_FORMATS.length ? [] : next);
    }
  };
  return (
    <div className="cgroup or">
      <div className="cgroup-head"><span className="cbadge or">or</span>{t("cb.formatsOr")}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {FILE_FORMATS.map((f) => {
          const on = keys.includes(f.id);
          return (
            <button key={f.id} type="button" className="vchip mono" disabled={!onChange} title={f.hint}
              onClick={() => toggle(f.id)} style={on ? { background: "var(--purple-bg)", color: "var(--purple)", borderColor: "color-mix(in srgb, var(--purple) 25%, transparent)" } : undefined}>
              {f.ext}
            </button>
          );
        })}
      </div>
      <div className="xs muted">{t("cb.formatsAny")}</div>
    </div>
  );
}
