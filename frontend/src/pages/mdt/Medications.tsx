// Current medication on the MDT body map (blue layer, as mockup1's <onco-anatomogram>): organs where each drug is
// absorbed / distributed / metabolised / excreted / acts, from the pharmacolibrary ADME database (DrugBank actors +
// SPC text), plus interaction candidates through a shared transporter / enzyme. Rule-based (GET /api/cases/{id}/medications).
import { useEffect, useState } from "react";
import { api, fmtDate } from "../../api";
import { useApp } from "../../ctx";

export type DrugSite = { organ: string | null; tissue: string; tissue_cs: string; process: string; genes: string[] };
export type Medication = {
  name: string; dose: string; schedule: string;
  sources: { doc_id: number; date: string | null; title: string; quote: string }[];
  drug: { slug: string; name: string; atc: string; drugbank_id: string } | null; sites: DrugSite[];
};
export type Interaction = { kind: "ddi_candidate" | "shared_substrate"; gene: string; perpetrator?: string; victim?: string;
  effect?: string; a?: string; b?: string; organs: string[] };
export type Meds = { medications: Medication[]; interactions: Interaction[]; db: string | null; evidence?: string[];
  hidden?: string[]; paused_anticoagulant: boolean; error?: string; cutoff: string };
export type Layer = "all" | "tumor" | "drugs";

export const DRUG_COLOUR = "#1b57ae";
// whole-body tissues (blood = the vessel tree, skin, fat, muscle): a fainter fill so the organs stay readable
const FAINT = new Set(["UBERON_0000014", "UBERON_0001013", "UBERON_0001134"]);
// blood: in the EBI figure it is the same vessel-tree drawing as the "blood vessels" finding – listed, not painted
export const NOT_PAINTED = new Set(["UBERON_0000178"]);

const TXT = {
  cs: {
    layer: "Vrstva", all: "Vše", tumor: "Nález", drugs: "Léky", meds: "Současná medikace", medsSub: "ADME – kde lék působí na orgány",
    ddi: "Možné lékové interakce", ddiSub: "sdílený transportér / enzym", ddiPill: "kandidát interakce", shared: "sdílený aktér",
    notFound: "nenalezeno v databázi ADME", noSites: "v databázi bez orgánových míst", none: "Bez medikace v dokumentaci do data MDT.",
    off: "mimo nákres", legendDrug: "orgán ovlivněný medikací", legendBoth: "nález i medikace",
    paused: "Antikoagulancia byla pozastavena před biopsií – ověřte, zda je pacient znovu užívá.",
    note: (f: string, ev: string) => `pharmacolibrary ADME (DrugBank, ClinPGx) · ${f} · evidence: ${ev}. Barvení pravidlem, ne AI.`,
    proc: { absorption: "absorpce", distribution: "distribuce", metabolism: "metabolismus", excretion: "vylučování", target: "cíl účinku" } as Record<string, string>,
    ddiText: (x: Interaction) => `${x.perpetrator} ${x.effect?.includes("inducer") ? "indukuje" : "inhibuje"} ${x.gene}, jehož substrátem je ${x.victim}`,
    sharedText: (x: Interaction) => `${x.a} i ${x.b} jsou substráty ${x.gene}`,
  },
  en: {
    layer: "Layer", all: "All", tumor: "Findings", drugs: "Drugs", meds: "Current medication", medsSub: "ADME – where each drug acts on organs",
    ddi: "Possible drug interactions", ddiSub: "shared transporter / enzyme", ddiPill: "interaction candidate", shared: "shared actor",
    notFound: "not found in the ADME database", noSites: "no organ sites in the database", none: "No medication in the reports up to the MDT date.",
    off: "not in drawing", legendDrug: "organ affected by medication", legendBoth: "finding and medication",
    paused: "Anticoagulants were paused before the biopsy – check whether the patient takes them again.",
    note: (f: string, ev: string) => `pharmacolibrary ADME (DrugBank, ClinPGx) · ${f} · evidence: ${ev}. Coloured by rules, not AI.`,
    proc: {} as Record<string, string>,
    ddiText: (x: Interaction) => `${x.perpetrator} ${x.effect?.includes("inducer") ? "induces" : "inhibits"} ${x.gene}, of which ${x.victim} is a substrate`,
    sharedText: (x: Interaction) => `${x.a} and ${x.b} are both substrates of ${x.gene}`,
  },
};
export const useMedTxt = () => TXT[useApp().lang === "en" ? "en" : "cs"];

export function useMedications(caseId: number): Meds | null {
  const [m, setM] = useState<Meds | null>(null);
  useEffect(() => { setM(null); api.get<Meds>(`/api/cases/${caseId}/medications`).then(setM).catch(() => undefined); }, [caseId]);
  return m;
}

/** Organ id → the drug sites drawn there. */
export function drugOrgans(m: Meds | null): Map<string, { drug: Medication; site: DrugSite }[]> {
  const out = new Map<string, { drug: Medication; site: DrugSite }[]>();
  for (const d of m?.medications ?? []) for (const s of d.sites) if (s.organ && !NOT_PAINTED.has(s.organ)) out.set(s.organ, [...(out.get(s.organ) ?? []), { drug: d, site: s }]);
  return out;
}

/** Paint the drug layer: blue fill where there is no finding, a blue outline where there is one. */
export function paintDrug(el: SVGElement, organ: string, withFinding: boolean, hover = false) {
  if (withFinding) {
    el.style.stroke = DRUG_COLOUR;
    el.style.strokeWidth = "1.2";
    return;
  }
  el.style.fill = DRUG_COLOUR;
  el.style.opacity = String((FAINT.has(organ) ? 0.1 : 0.5) + (hover ? 0.2 : 0));
}

export function LayerSwitch({ layer, setLayer }: { layer: Layer; setLayer: (l: Layer) => void }) {
  const x = useMedTxt();
  return (
    <div className="row" role="group" aria-label={x.layer} style={{ gap: 0 }}>
      {(["all", "tumor", "drugs"] as Layer[]).map((l) => (
        <button key={l} className={`sm ${layer === l ? "primary" : "ghost"}`} aria-pressed={layer === l} onClick={() => setLayer(l)}>{x[l]}</button>
      ))}
    </div>
  );
}

export function DrugLegend() {
  const x = useMedTxt();
  return (
    <>
      <span><i style={{ background: DRUG_COLOUR }} />{x.legendDrug}</span>
      <span><i style={{ background: "transparent", border: `2px solid ${DRUG_COLOUR}` }} />{x.legendBoth}</span>
    </>
  );
}

export function MedicationList({ m, drawn, onHover }: {
  m: Meds | null; drawn: (organ: string) => boolean; onHover: (organs: string[] | null) => void;
}) {
  const x = useMedTxt();
  const { lang } = useApp();
  if (!m) return null;
  const proc = (p: string) => x.proc[p] ?? p;
  const tissue = (s: DrugSite) => (lang === "en" ? s.tissue : s.tissue_cs);
  const groups = (d: Medication) => {
    const g = new Map<string, { organ: string | null; label: string; procs: string[] }>();
    for (const s of d.sites) {
      const k = s.organ && !NOT_PAINTED.has(s.organ) && drawn(s.organ) ? s.organ : `off:${s.tissue}`;
      const e = g.get(k) ?? { organ: k.startsWith("off:") ? null : k, label: tissue(s), procs: [] };
      if (!e.procs.includes(s.process)) e.procs.push(s.process);
      g.set(k, e);
    }
    return [...g.values()];
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <div>
        <div className="section-title" style={{ margin: 0 }}>{x.meds}</div>
        <div className="xs muted">{x.medsSub}</div>
      </div>
      {m.paused_anticoagulant && <div className="xs" style={{ color: "var(--yellow)" }}>{x.paused}</div>}
      {m.error && <div className="xs" style={{ color: "var(--red)" }}>{m.error}</div>}
      {!m.medications.length && <div className="xs muted">{x.none}</div>}
      {m.medications.map((d) => (
        <div key={d.name} className="bm-site" style={{ cursor: "default" }}
          onMouseEnter={() => onHover(d.sites.map((s) => s.organ).filter((o): o is string => !!o))} onMouseLeave={() => onHover(null)}>
          <div className="row" style={{ gap: 8 }}>
            <i className="bm-dot" style={{ background: d.drug ? DRUG_COLOUR : "var(--faint)" }} />
            <b className="small">{d.name}</b>
            <span className="xs muted">{[d.dose, d.schedule].filter(Boolean).join(" · ")}</span>
            {d.drug?.atc && <span className="xs faint right">ATC {d.drug.atc}</span>}
          </div>
          {!d.drug ? <span className="tag yellow" style={{ marginTop: 4 }}>{x.notFound}</span>
            : !d.sites.length ? <div className="xs muted">{x.noSites}</div>
            : <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                {groups(d).map((g) => (
                  <span key={g.label} className="tag" style={{ whiteSpace: "normal", maxWidth: "100%", ...(g.organ ? { color: DRUG_COLOUR } : { borderStyle: "dashed" }) }}
                    onMouseEnter={g.organ ? (e) => { e.stopPropagation(); onHover([g.organ!]); } : undefined}>
                    {g.label} · {g.procs.map(proc).join(", ")}{!g.organ && ` (${x.off})`}
                  </span>
                ))}
              </div>}
          <div className="xs faint" style={{ marginTop: 3 }}>
            {d.sources.map((s) => <a key={s.doc_id} className="cite" href={`/api/documents/${s.doc_id}/raw`} title={s.quote}>D{s.doc_id}</a>)}
            {" "}{fmtDate(d.sources[d.sources.length - 1]?.date)}{d.drug?.drugbank_id && ` · DrugBank ${d.drug.drugbank_id}`}
          </div>
        </div>
      ))}
      {m.interactions.length > 0 && (
        <>
          <div style={{ marginTop: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>{x.ddi}</div>
            <div className="xs muted">{x.ddiSub}</div>
          </div>
          {m.interactions.map((i, k) => (
            <div key={k} className="bm-site" style={{ cursor: "default" }} onMouseEnter={() => onHover(i.organs)} onMouseLeave={() => onHover(null)}>
              <div className="row" style={{ gap: 8 }}>
                <span className="small grow">{i.kind === "ddi_candidate" ? x.ddiText(i) : x.sharedText(i)}</span>
                <span className={`tag ${i.kind === "ddi_candidate" ? "yellow" : ""}`}>{i.kind === "ddi_candidate" ? x.ddiPill : x.shared}</span>
              </div>
            </div>
          ))}
        </>
      )}
      {m.db && <div className="xs faint">{x.note(m.db, (m.evidence ?? []).join(", "))}</div>}
    </div>
  );
}
