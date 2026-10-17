# Plan: 02 Koordinátor KOC – screens and features for the Rakathon 2026 assignment

Source: `data/rakathon_final_all/Zadani_ulohy.docx` (+ `Handover_obsah.docx`, `MDT_zapis.docx`, `MDT zaver.docx`,
reports 01–13). Demo case: Alena Procházková (`prochazkova`, already in the prototype). Status: **proposal, not built**.

## 1. What the assignment asks of the coordinator vs. what the prototype has

| Capability (Zadání) | Prototype today | Missing |
|---|---|---|
| **Převzít** – accept the GP's request and documents | Queue card "Převzít a spustit sadu", care-plan template, SMS, ECOG request to the GP | Intake of an *incoming document* (request arrives as DOCX/PDF/e-mail, not via our GP screen); check of the request (urgency, consent, contact person); "odmítnout / přesměrovat" |
| **Vyžádat a shromáždit** – request reports from other sites, one place for all documents | Only a free-text message thread; uploads exist on the GP screen | A **document register**: expected vs. received documents per site, request status, reminders, upload per document, cut-off (after MDT = excluded) |
| **Vytěžit** – AI extraction per *Handover_obsah*, flag missing/conflicting | Handover as 4–15 text sections; `flags` (chybí / nesoulad / pozn.) in data only; `<doc-gap-scan>` finds pathway steps with two-model cross-check | Field-level extraction into the *Handover_obsah* structure with **provenance per field** (document + quote), conflict detection across documents, "převzít / opravit / doptat se" per field, never guessing |
| **Koordinovat** – plan and track steps with date, place, status | Task plan with owner, due, dependencies, blocking; `place` added for Procházková | Calendar/timeline view across sites (KOC 1 Severní, KOC 2 Lipová, external), rescheduling, patient notification per step, precautions as tasks (apixaban 48 h), post-MDT steps |
| **Připravit podklad pro MDT** – include arranged exams, only data known by 21. 10. | MDT screen shows the pre-baked state; anatomogram, pathway, missing list | Explicit **cut-off date** filter, MDT checklist with "ready / missing / conflict", generated **podklad** (handover as of the date) and the **MDT_zapis** draft (sections 1–5 pre-filled) |
| **Uzavřít smyčku** – send MDT report to the GP, document delivery | MDT upload → AI structuring → send → simulated GP ack after 4 s | Choice of channel (aplikace / e-mail / datová schránka), attachment = zápis PDF, **delivery log** (sent, delivered, read, confirmed), reminder if not confirmed, copy to patient/daughter per consent |

## 2. Proposed views for the coordinator

Several pages, all on the coordinator route so they share the screen's selected case and demo clock
(`currentScreen()` matches `#/koordinator…` by its letters, so `#/koordinator-dokumenty` still counts as
`koordinator`). A sticky **case bar** (`<case-header>` + tab nav) is common to views B–G.

**A. Pracovní fronta** (`#/koordinator`, exists): queue + KPI. Add an *Příchozí* tab for unprocessed incoming
requests (document drop zone / e-mail import), and grouping by the next MDT date ("MDT GIT 21. 10.: 3 případy, 1 neúplný").

**B. Přehled případu** (`#/koordinator`, detail column, exists): tracker 01–04, next steps, open issues
(missing + conflicts), last messages. Keep it the "what do I do now" page; move the detail into C–G.

**C. Dokumenty – Vyžádat a shromáždit** (`#/koordinator-dokumenty`, new `<doc-register>`):
- One row per expected or received document: no., date, site, type, author, status
  `očekáváno → vyžádáno → přijato → vytěženo`, plus `po MDT – nezahrnuto` (12, 13) and `duplicitní`.
- Expected documents come from the request (report 07 lists 5 exams with their sites) and from the care plan
  (CT KOC 1, EUS, labs, histology).
- "Vyžádat" builds a request per site (templated text, consent note, deadline) and logs it; "Připomenout".
- Upload or drag & drop per row or in bulk. AI classification (`classify-document`) proposes date/site/type; the coordinator confirms.
- Preview of the original next to the extracted text.

**D. Vytěžení – Handover** (`#/koordinator-handover`, new `<handover-form>`):
- The *Handover_obsah* fields as a form (nacionále, kontakty, diagnóza, epikríza, otázka na MDT, OA, FA, AA,
  PS/Karnofsky, váha/výška, symptomy, provedená vyšetření as a table date | místo | typ | plné znění, laboratoř + TM,
  histologie, jiná sdělení/přání).
- Each field shows its value, source document + quote (server-verified, as in `<doc-gap-scan>`) and a state:
  `vyplněno` / `chybí` / `nesoulad` / `upraveno koordinátorem`.
- Conflicts list both values with their sources. Examples in this case: apixaban "poslední dávka 18. 10." vs. EUS
  on 12. 10.; histology "odběr 20. 10." vs. issued 19. 10.; weight 69 → 65 kg.
- Actions per field: Převzít · Opravit · Doptat se (pre-filled message to the GP/site) · Označit jako nedostupné.
- Two-model cross-check reused. AI never fills a field that has no quote ("bez domýšlení").
- Export of the handover (DOCX/PDF, as `data/demo/handover-prochazkova.*`).

**E. Koordinace – plán a kalendář** (`#/koordinator-plan`, extends `<task-plan>`):
- Timeline/calendar by day with columns per site.
- Task card: what, where (site + address), when, who, status, dependency, precaution (apixaban 48 h before EUS),
  patient notified yes/no, result document linked to C.
- Drag to reschedule (dependency check); "SMS pacientce" per step; steps marked `po MDT` (algeziolog, psycholog)
  stay out of the MDT podklad.

**F. Podklad pro MDT** (`#/koordinator-mdt`, new `<mdt-prep>`):
- Board picker (MDT GIT 21. 10. 14:00) and **cut-off** ("údaje známé do 20. 10. 2026"). Documents after the cut-off
  are greyed out with a reason.
- Readiness checklist from the template (`mdtChecklist`) with ready / missing / conflict and who is on it.
- Generated **podklad** (handover as of the cut-off) and **draft MDT_zapis**: sections 1 Základní údaje,
  3 Diagnóza, 4 Komorbidity and 5 Výsledky (datum | vyšetření | výsledek) pre-filled from D. Section 2 Členové
  comes from the board roster. Sections 6–7 are filled at or after the board.
- "Přidat na program MDT", "Odeslat podklad členům".

**G. Závěr a předání** (`#/koordinator-zaver`, extends `<mdt-upload>`):
- Upload the signed zápis or finish the draft from F. AI structures it into diagnosis, conclusion and recommendations,
  and the recommendations become follow-up tasks (onko konzilium 4. 11. 10:30, ECOG, labs, biliary drainage
  assessment, nutrition, pain, psycho-oncology, apixaban coordination).
- Send to the GP with the PDF attached and a channel choice; optionally inform the patient/daughter (consent stored
  with the case).
- **Delivery log** (odesláno → doručeno → přečteno → potvrzeno), reminder after N days, closing the case only after
  confirmation (or a documented reason).

## 3. Cross-cutting changes

- **Demo clock per case** is done (`cases.js demoDates`). Next: a *stepper* on the coordinator screen
  (2. 10. → 8. 10. → 12. 10. → 15. 10. → 19. 10. → 21. 10.) that jumps the case to pre-baked states so the
  three-week story can be clicked through. Today the coordinator's date stays at 2. 10.
- **Data model**:
  - `c.documents[]` {id, no, date, site, type, author, status, requestedAt, receivedAt, file, excludedReason}
  - `c.handover.fields{}` per *Handover_obsah* with `value`, `sources[]`, `state`
  - `c.mdtRecord` per *MDT_zapis*
  - `c.deliveries[]` {to, channel, sentAt, deliveredAt, confirmedAt}
  - tasks get `place` (added) and `notifiedAt`
- **Accepting a document finding** on the coordinator screen should also offer to complete the linked task
  (today the pathway step turns done while the task stays running).
- **Multi-site shared care**: KOC 1 (Severní) does the CT, KOC 2 (Lipová) owns the case. Show the owner KOC and
  partner sites explicitly; requests to KOC 1 go through the same register.
- **Consent and contacts**: contact person + consent scope (daughter informed) as structured data, checked before
  sending anything to the daughter.
- **Audit/provenance**: every field change, request, send and confirmation in one case log (also feeds the VZP reviewer).

## 4. Data issues in the competition case the demo should surface (not fix)

- ECOG/Karnofsky missing in all reports (MDT asks to determine it); patient e-mail missing; no explicit MDT question.
- EUS report 12. 10.: "apixaban vysazen 48 h, poslední dávka 18. 10." (after the procedure); restart "od 21. 10.".
- Histology: "odběr 20. 10. 2026" after the issue date 19. 10. and after the EUS on 12. 10.
- Biliary drainage not documented although cholestasis persists (bilirubin 23, ALP 3,40 on 15. 10.).
- MDT zápis: oncology appointment with MUDr. Kalous, who is listed as *radiační onkologie* – verify.
- Reports 12 (algeziologie 26. 10.) and 13 (psychologie 27. 10.) postdate the MDT and must not enter the podklad.

## 5. Suggested order

1. **C Dokumenty** + `c.documents` (makes "Vyžádat a shromáždit" and the cut-off visible). About 1 day.
2. **D Handover form** with field provenance and conflicts, reusing the scan backend with a *Handover_obsah* schema. About 1–1.5 days.
3. **F Podklad + MDT_zapis draft** with export (reuse `scripts/prochazkova_docs.py` layout in the browser). About 1 day.
4. **G Delivery log** + recommendations → tasks. About 0.5 day.
5. **E Calendar** and the demo-clock stepper. About 1 day.
6. Queue "Příchozí" intake. About 0.5 day.
