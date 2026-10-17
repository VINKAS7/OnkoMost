import { useEffect, useRef, useState } from "react";

/** Fact kinds of the patient graph: label + node colour. Shared by the graph and the documents table. */
export const KINDS: Record<string, { en: string; cs: string; color: string }> = {
  patient: { en: "Patient", cs: "Pacient", color: "var(--text)" }, document: { en: "Document", cs: "Dokument", color: "#9b9a97" },
  facility: { en: "Facility", cs: "Pracoviště", color: "#c7c6c3" }, diagnosis: { en: "Diagnosis", cs: "Diagnóza", color: "#d44c47" },
  condition: { en: "Comorbidity", cs: "Komorbidita", color: "#d9730d" }, medication: { en: "Medication", cs: "Lék", color: "#448361" },
  symptom: { en: "Symptom", cs: "Symptom", color: "#cb912f" }, exam: { en: "Exam", cs: "Vyšetření", color: "#337ea9" },
  lab: { en: "Lab value", cs: "Laboratoř", color: "#6f7fd1" }, measurement: { en: "Measurement", cs: "Měření", color: "#4ba3b8" },
  note: { en: "Note", cs: "Poznámka", color: "#9065b0" }, precaution: { en: "Precaution", cs: "Opatření", color: "#c14c8a" },
  mentioned_exam: { en: "Mentioned exam", cs: "Zmíněné vyšetření", color: "#9b9a97" },
  contact_person: { en: "Contact", cs: "Kontakt", color: "#7a8f4f" }, referring_doctor: { en: "Referring doctor", cs: "Referující lékař", color: "#7a8f4f" },
  allergy: { en: "Allergy", cs: "Alergie", color: "#d9730d" }, epikriza: { en: "Summary", cs: "Epikríza", color: "#9b9a97" },
  mdt_question: { en: "MDT question", cs: "Otázka na MDT", color: "#9b9a97" },
};

/** Internal bookkeeping facts (which pathway step a document fulfils) – not clinical content. */
export const HIDDEN_KINDS = new Set(["node_match"]);

export function kindLabel(kind: string, lang: "en" | "cs"): string {
  return KINDS[kind]?.[lang] ?? kind.replace(/_/g, " ");
}

/** Rows of the journey timeline, in display order. */
export const DOC_CATEGORIES = ["referral", "imaging", "lab", "pathology", "specialist", "mdt", "other"] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export function docCategory(docType: string): DocCategory {
  if (docType === "referral" || docType === "gp_summary") return "referral";
  if (docType === "imaging") return "imaging";
  if (docType === "lab") return "lab";
  if (docType === "procedure" || docType === "histology") return "pathology";
  if (docType === "mdt_conclusion") return "mdt";
  if (docType.endsWith("_report")) return "specialist";
  return "other";
}

/** Width of an element, kept up to date with a ResizeObserver (charts draw to the real width). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Days since 1970 for an ISO date (timezone-proof: dates are calendar days). */
export function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** "2026-10-27" + 14 → "2026-11-10" */
export const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
