// Patient identity read from uploaded documents (rules + LLM, POST /api/identity/scan) and the user's decision on a
// mismatch: remove the document, keep it, or take the document's name / RČ. The app highlights, the user decides.
//   <IdentityFiles>      GP referral form: scans each added file, fills empty name / RČ, flags differences
//   <DocIdentityActions> case documents: actions for a document whose identity differs from the case
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../api";
import { useAction, useApp } from "../ctx";
import type { CaseDetail, DocumentRow } from "../types";

type Field = { value: string; source: string; conflict?: string };
type Found = { patient_name: string; rc: string; dob: string | null; fields: Record<string, Field>; llm_error?: string };
type Scan = { state: "scanning" | "done" | "error"; found?: Found; error?: string; kept?: boolean };

const TXT = {
  cs: {
    scanning: "AI čte jméno a RČ…", found: "V dokumentu", none: "jméno ani RČ v dokumentu nenalezeno", src: "zdroj", nameLbl: "jméno",
    filled: "doplněno z dokumentu", mismatch: "Nesoulad s údaji pacienta", remove: "Odebrat dokument", keep: "Ponechat",
    take: "Převzít údaje z dokumentu", kept: "ponecháno přes nesoulad", decide: "Rozhodněte u dokumentů s nesouladem identity.",
    takeCase: "Převzít údaje do případu", keepDoc: "Ponechat a zpracovat", del: "Smazat dokument",
    confirmDel: "Smazat dokument „{f}“ z případu?", confirmTake: "Změnit jméno / RČ pacienta podle dokumentu „{f}“? Ostatní dokumenty se znovu porovnají a mohou být v nesouladu.",
    keptBy: "ponecháno přes nesoulad identity", conflict: "pravidla a AI se liší", llmOff: "AI nedostupná – jen pravidla",
    deleted: "Dokument smazán", updated: "Údaje pacienta změněny · znovu porovnáno dokumentů: {n}",
  },
  en: {
    scanning: "AI is reading name and birth number…", found: "In the document", none: "no name or birth number found", src: "source", nameLbl: "name",
    filled: "filled in from the document", mismatch: "Differs from the patient's details", remove: "Remove document", keep: "Keep",
    take: "Use the document's details", kept: "kept despite the difference", decide: "Decide on the documents whose identity differs.",
    takeCase: "Use for the case", keepDoc: "Keep and process", del: "Delete document",
    confirmDel: "Delete the document “{f}” from the case?", confirmTake: "Change the patient's name / birth number to those in “{f}”? The other documents are re-checked and may then differ.",
    keptBy: "kept despite an identity difference", conflict: "rules and AI differ", llmOff: "AI unavailable – rules only",
    deleted: "Document deleted", updated: "Patient details changed · documents re-checked: {n}",
  },
};
const useTxt = () => TXT[useApp().lang === "en" ? "en" : "cs"];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
const digits = (s: string) => s.replace(/\D/g, "");
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/** Differences between a document's identity and the entered one ([] = consistent or not comparable). */
export function identityIssues(found: Found | undefined, name: string, rc: string): string[] {
  if (!found) return [];
  const out: string[] = [];
  if (found.rc && digits(rc) && digits(found.rc) !== digits(rc)) out.push(`RČ ${found.rc} ≠ ${rc}`);
  if (found.patient_name && name.trim() && fold(found.patient_name) !== fold(name)) out.push(`„${found.patient_name}“ ≠ „${name.trim()}“`);
  return out;
}

const box = (warn: boolean): CSSProperties => ({
  borderLeft: `3px solid var(--${warn ? "orange" : "line-strong"})`, padding: "4px 8px", marginTop: 4,
  background: warn ? "var(--orange-soft, rgba(255,165,0,.08))" : undefined,
});

export function IdentityFiles({ files, name, rc, setName, setRc, removeFile, onState }: {
  files: File[]; name: string; rc: string; setName: (v: string) => void; setRc: (v: string) => void;
  removeFile: (i: number) => void; onState: (s: { pending: boolean; undecided: number; kept: string[] }) => void;
}) {
  const t = useTxt();
  const [scans, setScans] = useState<Record<string, Scan>>({});
  const [filledFrom, setFilledFrom] = useState<{ name?: string; rc?: string }>({});
  const started = useRef(new Set<string>());

  useEffect(() => {
    for (const f of files) {
      const k = fileKey(f);
      if (started.current.has(k)) continue;
      started.current.add(k);
      setScans((s) => ({ ...s, [k]: { state: "scanning" } }));
      const fd = new FormData();
      fd.append("file", f);
      api.post<{ found: Found }>("/api/identity/scan", fd)
        .then((r) => setScans((s) => ({ ...s, [k]: { state: "done", found: r.found } })))
        .catch((e: Error) => setScans((s) => ({ ...s, [k]: { state: "error", error: e.message } })));
    }
  }, [files]);

  // empty name / RČ: fill from the first document that has them (the user can still edit)
  useEffect(() => {
    for (const f of files) {
      const found = scans[fileKey(f)]?.found;
      if (!found) continue;
      if (!name.trim() && found.patient_name) { setName(found.patient_name); setFilledFrom((x) => ({ ...x, name: f.name })); }
      if (!rc.trim() && found.rc) { setRc(found.rc); setFilledFrom((x) => ({ ...x, rc: f.name })); }
    }
  }, [scans, files]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = files.map((f, i) => {
    const sc = scans[fileKey(f)];
    return { f, i, sc, issues: identityIssues(sc?.found, name, rc) };
  });
  const undecided = rows.filter((r) => r.issues.length && !r.sc?.kept).length;
  const pending = rows.some((r) => r.sc?.state === "scanning");
  const kept = rows.filter((r) => r.issues.length && r.sc?.kept).map((r) => r.f.name);
  useEffect(() => { onState({ pending, undecided, kept }); }, [pending, undecided, kept.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const keep = (f: File) => setScans((s) => ({ ...s, [fileKey(f)]: { ...s[fileKey(f)], kept: true } }));
  const take = (found: Found) => {
    if (found.patient_name) setName(found.patient_name);
    if (found.rc) setRc(found.rc);
    setFilledFrom({});
  };

  return (
    <div className="col" style={{ gap: 4 }}>
      {(filledFrom.name || filledFrom.rc) && (
        <div className="xs muted">✓ {t.filled}: {[filledFrom.name && `${t.nameLbl} ← ${filledFrom.name}`, filledFrom.rc && `RČ ← ${filledFrom.rc}`].filter(Boolean).join(" · ")}</div>
      )}
      {rows.map(({ f, i, sc, issues }) => {
        const warn = issues.length > 0 && !sc?.kept;
        const fd = sc?.found;
        return (
          <div key={fileKey(f)} className="small" style={box(issues.length > 0)}>
            <div className="row"><span className="grow">{f.name}</span>
              {!warn && <button className="sm ghost" onClick={() => removeFile(i)}>{t.remove}</button>}</div>
            {sc?.state === "scanning" && <div className="xs muted">{t.scanning}</div>}
            {sc?.state === "error" && <div className="xs" style={{ color: "var(--red)" }}>{sc.error}</div>}
            {fd && (
              <div className="xs muted">
                {fd.patient_name || fd.rc
                  ? <>{t.found}: <b>{fd.patient_name || "—"}</b> · RČ <b>{fd.rc || "—"}</b>
                      {" "}({t.src}: {Object.values(fd.fields).map((x) => x.source).filter((v, j, a) => a.indexOf(v) === j).join(", ")})
                      {Object.values(fd.fields).some((x) => x.conflict) && <> · {t.conflict}</>}</>
                  : t.none}
                {fd.llm_error && <> · {t.llmOff}</>}
              </div>
            )}
            {issues.length > 0 && (
              <div className="xs" style={{ marginTop: 2 }}>
                <b style={{ color: "var(--orange)" }}>{sc?.kept ? t.kept : t.mismatch}:</b> {issues.join("; ")}
              </div>
            )}
            {warn && fd && (
              <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                <button className="sm" onClick={() => removeFile(i)}>{t.remove}</button>
                <button className="sm" onClick={() => keep(f)}>{t.keep}</button>
                <button className="sm" onClick={() => take(fd)}>{t.take}</button>
              </div>
            )}
          </div>
        );
      })}
      {undecided > 0 && <div className="xs" style={{ color: "var(--orange)" }}>{t.decide}</div>}
    </div>
  );
}

/** After a referral is sent: documents the GP chose to keep despite a difference are processed, not blocked. */
export async function keepAfterReferral(caseId: number, keptNames: string[], by: string) {
  if (!keptNames.length) return;
  const c = await api.get<CaseDetail>(`/api/cases/${caseId}`);
  await Promise.all(c.documents.filter((d) => keptNames.includes(d.filename))
    .map((d) => api.post(`/api/documents/${d.id}/identity/keep`, { by })));
}

export function DocIdentityActions({ c, d, reload }: { c: CaseDetail; d: DocumentRow; reload: () => void }) {
  const t = useTxt();
  const { actor, toast } = useApp();
  const { run, busy } = useAction();
  const accepted = d.identity?.accepted;
  const issues = d.identity?.issues?.filter((i) => !i.startsWith("Dokument neobsahuje")) ?? [];
  if (accepted) return <div className="xs" style={{ color: "var(--orange)", marginTop: 3 }}>{t.keptBy} ({accepted})</div>;
  if (!issues.length || d.status === "queued" || d.status === "processing") return null;
  const del = () => window.confirm(t.confirmDel.replace("{f}", d.filename))
    && run(() => api.del(`/api/documents/${d.id}?by=${encodeURIComponent(actor)}`), t.deleted, reload);
  const take = () => window.confirm(t.confirmTake.replace("{f}", d.filename))
    && run(() => api.put<{ rechecked: number }>(`/api/cases/${c.id}/identity`, { from_document: d.id, by: actor }),
      undefined, (r) => { toast(t.updated.replace("{n}", String(r.rechecked))); reload(); });
  return (
    <div style={box(true)}>
      <div className="xs"><b style={{ color: "var(--orange)" }}>{t.mismatch}</b></div>
      <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
        <button className="sm" disabled={busy} onClick={del}>{t.del}</button>
        {d.status === "blocked" && <button className="sm" disabled={busy} onClick={() => run(() => api.post(`/api/documents/${d.id}/identity/keep`, { by: actor }), "✓", reload)}>{t.keepDoc}</button>}
        <button className="sm" disabled={busy} onClick={take}>{t.takeCase}</button>
      </div>
    </div>
  );
}
