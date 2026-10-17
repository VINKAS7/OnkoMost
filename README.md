# Onkomost (OncoBridge)

**A shared platform for Czech cancer centres (KOC) that takes a patient from the GP's referral to the MDT decision and back to the GP, without losing information.**

Built for the Rakathon 2026 challenge *"Cesta pacienta bez ztráty informací"* (*The patient's journey without losing information*). The challenge itself is explained in plain English in `…/cesta-pacienta-data/rakathon_final_all/README.md`.

> All patient data is fictional (the Rakathon sample patient *Alena Procházková*).

---

## Three workspaces

| Workspace | Who | What they do |
|---|---|---|
| 🩺 **Referring doctor** (`/gp`) | GP or specialist | Enters only the **patient's name, birth number (RČ) and suspected cancer type**, picks a KOC and uploads the documents they already have. Later sees the case status, the MDT result, and confirms receipt. |
| 🏥 **Cancer centre – KOC** (`/koc`) | Coordinator | Sees each patient **on the pathway for their cancer type** (React Flow). Every step that needs a document is **green** (we have it), **red** (missing) or **yellow** (conflict between documents). Also: next steps with owners and deadlines, handover, documents, patient graph, sending the result, and **voting on pathway changes**. |
| ⚕️ **MDT meeting** (`/mdt`) | Multidisciplinary team | A **body map** (organs affected by the cancer, read by the LLM from the reports), case brief, warnings, **"Ask the case" (GraphRAG)** with cited sources, a sidebar of **original documents to download**, and the **decision to treat**: active monitoring / palliative care / chemotherapy / radiotherapy / surgery (more than one can be chosen). |

The whole UI switches between **English and Czech** (EN | CS in the sidebar). The design is minimal: no icons or emoji, status shown as small coloured dots.

```
GP: name + RČ + cancer type + documents
        │
        ▼
raw files stored unchanged ─► identity check (RČ + name + birth date) ─► rules + LLM extract facts with quotes
        │
        ▼
FHIR server (identity + documents) · IRIS globals patient graph (pseudonymous: patient → facts → documents)
+ document chunks in an IRIS SQL vector table (keyword BM25 + vector search)
        │
        ▼
KOC: patient graph vs. the cancer's pathway (fixed queries, no AI)
     green = have it · red = missing · yellow = conflict · dashed = depends on a decision
     → request missing reports, book exams, review conflicts, validate the handover
        │
        ▼
MDT: case brief + GraphRAG questions (only documents up to the MDT date) → decision to treat
        │
        ▼
KOC: result to the GP (receipt link) + insurer's review doctor → handover to K2 → closed
GP:  sees the result in their workspace and confirms receipt
```

The **8 case states** from the brief are computed from pathway progress:
Sent → In triage → Waiting for documents → Complete → Ready for MDT → MDT conclusion → Feedback sent → Closed.

### How it covers the Rakathon brief

| Slide / requirement | Where in Onkomost |
|---|---|
| 01 Referral without a new big form: pick a KOC, patient data, upload own reports (slide 7) | GP workspace `/gp` |
| 02 AI extraction into a fixed structure, missing data flagged, copy-able parts (slide 8) | KOC → case → Handover |
| 02 AI only drafts, a doctor validates (slide 8) | "Validate handover" by the KOC doctor (our reading of slide 8) |
| 02 Coordinator contacts the doctor for more information (slide 8) | Case → Messages / "Ask GP" (pre-filled from missing data); the GP answers or uploads in `/gp`. Clinics get report requests (Outbox) |
| 03 Queue new / active / on hold; detail with referral context + original; tasks with deadline and priority (slide 9) | KOC → Patients, case → Pathway |
| 03 Task set per diagnosis, order of steps, communication, deadline notifications, 8 states (slide 10) | Pathways, case flowchart, Messages, **Notifications** in the top bar, progress bar |
| 04 Result to the referring doctor with the original context; review doctor informed automatically and can ask for more; confirm and close (slide 11) | Case → MDT & result; GP confirms in `/gp`; the review doctor's link has "Request more information"; K2 handover closes the case |
| Structured KOC / MDT conclusion (slide 12) | MDT workspace decision → **final MDT record** (MDT_zapis .docx with 6 "Závěr MDT" and 7 "Doporučení MDT" filled) attached to the GP's message |
| Zadání: MDT report as of 21. 10. 2026 (later reports excluded), send to the GP with proof of delivery | MDT briefing / final record, receipt link |

### MDT body map

The MDT workspace opens with a body map on the left. It uses the [EBI Expression Atlas anatomogram](https://github.com/gxa/anatomogram) (CC BY 4.0), and the backend code is in `backend/reports/bodymap.py`.

1. **Read the reports.** All reports dated on or before the MDT date are read, the same cut-off as the brief and GraphRAG. Labs, pain and psychology reports are skipped.
2. **Extract.** The LLM lists, for each report section, the organs with a finding. Each finding has an organ from a fixed list, a status (*primary tumour, metastasis, involved, suspicious, examined negative*) and a verbatim Czech quote.
3. **Verify.** A finding is kept only when all of these hold:
   - Its quote is in the report.
   - The quote names the organ. If the model filed it under the wrong organ, the quote decides which organ it belongs to.
   - A "negative" quote actually reads as negative.
4. **Merge.** There is one entry per organ, and the most severe status wins. When reports disagree about an organ, it is flagged as a **conflict**.
5. **Fallback.** The organ of the case's pathway (lung, pancreas, breast) is always shown, marked "from the referral diagnosis" when no report names it.

Using the map:
- The figure follows the patient's sex, taken from the RČ.
- Clicking an organ **filters the brief and the document list** to the reports that mention it, and shows the quotes with D-links.
- Hovering a report outlines the organs it describes.
- Results are cached in `storage/bodymap/`, and re-run automatically when new reports arrive.
- The first run takes a few minutes; after that it is instant.

### Cancer pathways (one per cancer type)

Each pathway follows the current **ESMO Clinical Practice Guidelines** ([esmo.org/guidelines](https://www.esmo.org/guidelines)):

| Pathway | ICD-10 | Guideline | Diagnostic work-up |
|---|---|---|---|
| 🫁 Lung cancer | C34 | ESMO early & locally advanced NSCLC (Zer et al., Ann Oncol 2025; staging per Postmus et al. 2017) + metastatic NSCLC (Hendriks et al., Ann Oncol 2023) | CT chest + upper abdomen, labs → **diagnostic MDT: extent of disease** → *potentially curable*: PET-CT, lung function (FEV1, DLCO), invasive mediastinal staging (EBUS/EUS, if indicated) / *metastatic* → brain MRI, tissue sampling, histology (WHO 2021 subtype), **biomarkers** (PD-L1, EGFR, ALK, NGS panel; skipped automatically for small-cell carcinoma) |
| 🧬 Pancreatic cancer | C25 | ESMO pancreatic cancer (Conroy et al., Ann Oncol 2023) | Multiphasic CT chest–abdomen–pelvis (pancreatic protocol), labs + CA 19-9, anticoagulant pause, EUS-FNB, histology; optional: liver MRI, PET-CT, biliary drainage, germline BRCA1/2, tumour KRAS/MSI/NTRK; supportive care |
| 🎗️ Breast cancer | C50 | ESMO early breast cancer (Loibl et al., Ann Oncol 2024) | Family history + menopausal status, bilateral mammography + breast/axillary ultrasound, core biopsy, ER/PR/HER2/Ki-67, labs; optional: breast MRI, distant staging (CT + bone scan / PET-CT), germline BRCA1/2, echocardiography, fertility counselling |

Every step has a **title** (the only text on the canvas) and, when opened:
- **what it needs** – the description. It is also the LLM's brief: when a document arrives, steps without a machine-readable test (e.g. "lung function", "biomarkers") are matched by the LLM from the step's title + description, and it must quote the passage that proves the match;
- **why it is in the pathway** – the ESMO recommendation and its evidence level, e.g. `[III, A]`;
- the **accepted file formats**, whether it is **required** before the MDT or **optional**, and, in a case, the parsed document that satisfies it (✓).

All pathways reuse a standard ending (handover → treatment MDT → decision to treat with 5 options → feedback → K2 → closed). Steps after a decision (e.g. lung PET-CT) are shown as **"depends on decision"** until the decision is made, then become required or "not needed". They live in `seed/pathways/*.json` and are still **for clinicians to validate** before clinical use; the turnaround targets (SLA days) are local, not from ESMO.

**National governance.** Every KOC uses the same pathway per cancer type. A change is made in a **draft** and the draft is put to a vote. It passes only with **YES from more than half of all KOCs** (not only of those who voted) before the deadline. New referrals use the new version. Running cases stay on the version they started with.

## Design rules

1. **AI prepares, people decide.** The local LLM (`qwen3.5:4b`) only turns short free-text sections into lists, drafts request letters, suggests treatments from an imported MDT conclusion, and answers GraphRAG questions. Every extracted value keeps its source quote. If the quote isn't found in the document, the value is marked "check source". A doctor confirms the handover and the MDT confirms the decision.
2. **The comparison with the pathway is a fixed query, with the LLM only where a rule can't decide.** A pathway step has a `requires` list (e.g. `{"kind": "exam", "exam_type": "ct"}`), and each one is checked by a fixed query over the patient's graph in IRIS. That is what drives green / red / yellow. Steps marked `{"kind": "described"}` (and documents the parser could not classify) are matched by the LLM from the step's title + description, with a quote from the document as proof; a document the parser did classify is never re-judged for a different exam.
3. **GraphRAG on InterSystems IRIS** (after [IRIS-Global-GraphRAG](https://github.com/fanji-isc/IRIS-Global-GraphRAG) and [iris-vector-rag](https://github.com/intersystems-community/iris-vector-rag)):
   - The LLM turns the question (EN or CS) into Czech search terms.
   - Document chunks live in the IRIS SQL table `Onk.DocChunk` with a `VECTOR` column. Retrieval fuses **BM25 over the Czech terms** (light Czech stemming) with **vector search on the question** (`qwen3-embedding:0.6b` in Ollama, multilingual, so an English question finds Czech text) by reciprocal rank fusion. With `EMBED_MODEL` empty, or Ollama unreachable, only the keyword leg runs.
   - The graph in IRIS globals adds the core facts (diagnosis, exam conclusions, abnormal labs); identity comes from the FHIR Patient.
   - The LLM answers through a JSON schema and cites `[D<id>]`.
   - Citations are also matched deterministically. If nothing backs the answer, it is flagged "not backed by a document".
   - It never concludes something is absent just because it isn't mentioned (e.g. "no MRI in the documents" rather than "no metastases on MRI").
4. **Copy, don't guess.** Fixed-shape data is read by rules, with no LLM: header, OA/FA/AA lines, lab tables, ICD codes, dates, weight/height. Missing data is reported as missing.
5. **Time-aware.** Every fact keeps its document date. Only documents dated on or before the MDT date are searchable and used in the MDT report.

## Tech stack

| Part | Choice |
|---|---|
| Backend | Python 3.10 (conda env `Deep_Learning`), FastAPI, SQLAlchemy |
| Workflow data | SQLite (`backend/data/onkomost.sqlite3`); switch to Postgres by changing `SQLITE_URL` |
| Patient record (sensitive) | **InterSystems IRIS for Health FHIR R4 server** (`infra/iris`, set up like the [FHIR-AI-Hackathon-Kit](https://github.com/intersystems-community/FHIR-AI-Hackathon-Kit/tree/V2)). `Patient` (name, RČ, birth date, sex, insurer, address, phone), `RelatedPerson` (contact persons) and `DocumentReference` (each document: extracted text + original file). Every resource is tagged `onkomost`; nothing else on the server is touched |
| Patient graph | IRIS **globals** `^OnkGraph`, one partition per patient (the IRIS-Global-GraphRAG pattern). Pseudonymous: keyed by `patient_uuid`, no name/RČ/contacts |
| GraphRAG chunks | IRIS SQL table `Onk.DocChunk` with `VECTOR(FLOAT, 384)`; the patient's identifiers are masked in the stored text |
| AI | `qwen3.5:4b` (any Ollama model via `LLM_MODEL`) in the local Windows Ollama, JSON-schema output, temperature 0, answers cached in `storage/llm_cache/` |
| Embeddings | `qwen3-embedding:0.6b` in the same Ollama (1024 dims, 100+ languages, `EMBED_MODEL` / `EMBED_DIM`); fits on the GPU next to the LLM. Changing the model rebuilds `Onk.DocChunk` and re-embeds the stored text on the next start |
| Frontend | React 18 + Vite + TypeScript, React Flow (`@xyflow/react`) + dagre, EN/CS dictionary in `src/i18n.ts` |
| Documents | python-docx; optional Tesseract OCR (`ces`) for scans |

## Run it

All commands run from this folder (`onkomost/`). On Windows use `conda run`, because non-interactive shells cannot `conda activate`. In an interactive terminal, `conda activate Deep_Learning` works too.

```bash
# 0. one-time setup
cp backend/.env.example backend/.env            # then fill in IRIS_PASSWORD (and IRIS_HOST if the WSL IP changed)
wsl -e bash infra/iris/start.sh                 # IRIS for Health in Docker (WSL): namespace + FHIR R4 endpoint; ~4–5 GB disk
ollama pull qwen3.5:4b                          # the LLM, local Ollama (not WSL)
ollama pull qwen3-embedding:0.6b                # GraphRAG embeddings, 639 MB
cd frontend && npm install && npm run build && cd ..   # npm install also copies the anatomogram SVGs to public/

# 1. check IRIS, the FHIR server, Ollama (LLM + embeddings), SQLite and the sample data
conda run -n Deep_Learning python -m backend.config --check

# 2. load the sample case (pick where the story should stop)
conda run -n Deep_Learning python -m scripts.seed_demo --until histology    # diagnostics done, conflicts open
conda run -n Deep_Learning python -m scripts.seed_demo                      # whole story, ends closed
# optional: two more fictional MDT patients (lung, breast) + their body maps
conda run -n Deep_Learning python -m scripts.seed_cancer_demos --bodymap

# 3. start (serves the built UI too) → http://localhost:8000
conda run -n Deep_Learning uvicorn backend.api:app --port 8000

# frontend dev server with hot reload → http://localhost:5173 (proxies /api to :8000)
cd frontend && npm run dev
```

`seed_demo` steps: `referral, accepted, prior_reports, ct, biopsy, labs, histology, ready, mdt, feedback, closed`.
It sets the **demo date** to the date of each event (the sample case happens in October 2026). You can change the demo date in the top bar.

> Memory: the 4B LLM takes ~4.5 GB when loaded, the embedding model ~0.6 GB. On a machine with little free RAM, close other heavy programs before starting the server.

### Tests

```bash
conda run -n Deep_Learning python -m pytest tests -q
```

There are 40 tests. Among other things they check:
- extraction rules
- the RČ / identity check
- missing reports found from the referral alone
- a wrong-patient document gets blocked
- the **answer key** (`MDT zaver.docx`): CA 19-9 = 312, G2–G3, C25.0, CT 35 mm, the 3 comorbidities, 7 MDT members, ECOG missing, both impossible dates flagged, post-MDT reports excluded
- green / red / yellow document status on the pathway
- the lung extent decision (PET-CT and lung function "depend on decision", then skipped for metastatic disease; single choice enforced) and the biomarker step skipped only for small-cell carcinoma
- every seeded ESMO step has a title, description and "why" in both languages, and every evidence step lists its file formats
- GraphRAG finds CA 19-9 = 312 and cannot see the post-MDT pain report
- the feedback loop closes the case (MDT chose chemotherapy)
- the final MDT record contains the conclusion, the recommendations and the decision, and is attached to the GP message even without an imported .docx
- a question to the GP creates a waiting task that closes when the GP replies or uploads a document
- a review-doctor question creates a high-priority coordinator task and appears in notifications
- notifications list overdue tasks per centre
- governance (3 of 6 yes → rejected, 4 of 6 → active, a running case keeps v1; a new cancer type goes through the same vote, ICD codes can't overlap, an unsubmitted draft can be discarded)
- the body map's checks: a quote not in the report is dropped, the report's wording decides the organ, status and side ("HER2 negativní" does not make a carcinoma negative; "bez ložisek, bez metastáz" stays negative), the most severe status wins, conflicts are flagged only on the same side, the pathway organ is the fallback, sex from the RČ
- identity is only in FHIR: the case table has no name/RČ columns, and the graph globals and GraphRAG chunks contain no RČ or name
- **non-Onkomost FHIR data is unchanged**

The tests use their own SQLite file, but they rebuild Onkomost's data in IRIS (`^OnkGraph`, `Onk.DocChunk`, the tagged FHIR resources). Re-run `seed_demo` afterwards.

## Demo script (≈ 6 minutes)

`seed_demo --until histology` leaves the sample patient with diagnostics complete and two open conflicts.

1. **Start page** – the three workspaces. Switch EN ↔ CS anywhere.
2. **🩺 Referring doctor** – show the short form (name, RČ, cancer type, documents). *My referrals* lists Alena with her status and ✓/✕/! document counts. (Live: `seed_demo --until referral`, then upload `07_PL_zadost_KOC2_2026-10-02.docx` here, with demo date 2026-10-02.)
3. **🏥 KOC → Patients → Alena → Pathway**:
   - The pancreatic pathway, colour-coded:
     - CT, biopsy, histology, CA 19-9 → **green**
     - the biopsy and histology reports → **yellow**: their dates conflict (last dose 18 Oct after a 12 Oct biopsy; sample taken 20 Oct but reported 19 Oct)
     - pain specialist and psycho-oncology → **red**, optional
   - The *Document checklist* explains each item.
   - Mark the conflicts as reviewed. On a *missing data* task click **Ask GP**: a pre-filled question goes to the referring doctor; in the GP workspace answer it (or upload a document) and the waiting task closes.
   - Validate the **Handover** (sources marked AI were read by the LLM), and generate the MDT briefing under **MDT & result**.
4. **🗺️ Cancer pathways → Lung** – the ESMO work-up with the *potentially curable* / *metastatic* decision; open any step to see what it needs, why (ESMO recommendation + evidence level), its file formats and whether it is optional.
5. **⚕️ MDT → Alena**:
   - The **body map**:
     - the female figure, with the pancreas as the primary tumour, the mesenteric vessels involved, and a suspicious peripancreatic lymph node
     - liver, lungs, kidneys, gallbladder and bones examined negative
     - click *Pancreas*: the brief and documents narrow to the 4 reports that describe it
   - The case brief and warnings.
   - **Ask the case**, e.g. "What is the CA 19-9?" (answer with D-citations) or "Does she have brain metastases on MRI?" ("not in the documents").
   - Open source documents from the sidebar.
   - **Import signed conclusion** (`MDT zaver.docx`): chemotherapy is suggested. Then **Record MDT decision**.
6. **🏥 KOC → MDT & result** – send the result: the GP gets the final MDT record (sections 6/7 filled) and the review doctor gets a structured summary. Open the review doctor's link (Outbox) and use *Request more information*: the question appears under **Notifications** and as a task; answer it with *Reply*.
7. **🩺 Referring doctor** – the result appears under *My referrals*; **Confirm receipt**.
8. **🏥 KOC** – *Hand over to K2*: the case is **Closed**, the chosen treatment is highlighted on the pathway, and the full audit trail is kept.
9. **🗳️ Governance** – propose adding a step (e.g. BRCA testing) and vote YES as 4 of the 6 KOCs: v2 becomes active.

## Project layout

```
backend/
  config.py              settings from backend/.env; `python -m backend.config --check`
  api.py                 REST API (+ serves frontend/dist)
  seed.py                KOCs + cancer pathways (standard MDT ending shared by all pathways)
  ingest/                reader (docx/OCR, sections, header), classify, identity (RČ)
  extract/               pipeline (rules + LLM), labs, schemas, verify (quote check), llm (Ollama client + cache)
  rag/ask.py             GraphRAG: hybrid chunk retrieval + graph facts → LLM answer with citations
  rag/index.py           IRIS SQL vector table Onk.DocChunk: BM25 + VECTOR_COSINE (Ollama embeddings), fused by RRF;
                         identifier masking; `python -m backend.rag.index --reindex` re-embeds every chunk
  graph/store.py         patient graph in IRIS globals (^OnkGraph), per-patient snapshot reads
  fhir/                  client (FHIR R4 REST) + records (Patient / RelatedPerson / DocumentReference mapping)
  iris.py                shared IRIS connection (DB-API SQL + native API globals)
  pathway/               model (JSON + validation + diff), conformance (graph checks → green/red/yellow + findings),
                         governance (votes)
  reports/               handover (Handover_obsah, EN labels), mdt (MDT_zapis .docx + conclusion parsing + treatment
                         suggestion), feedback (messages), bodymap (LLM organ findings for the MDT body map)
  workflow/              db (SQLAlchemy models, demo clock, audit), service (cases, tasks, decisions, states, actions)
frontend/src/            React app: i18n.ts (EN/CS), pages/gp (GP portal), pages/koc (patients, case tabs, pathways,
                         editor, proposals, outbox), pages/mdt (meetings, workspace with GraphRAG + decision), AckPage
seed/                    kocs.json (6 fictional KOCs), pathways/*.json (lung, pancreas, breast – ESMO-based)
scripts/seed_demo.py     replays the Rakathon sample case day by day
scripts/seed_cancer_demos.py  two more fictional MDT patients (lung, breast)
tests/                   pytest suite
storage/                 raw/ (immutable originals), llm_cache/, reports/ (generated .docx), bodymap/ (body map results)
```

## Known limits (prototype)

- **The pathways follow ESMO but are not clinically validated.** The full text of the 2025 early-NSCLC guideline could not be retrieved, so lung staging details follow the 2017 edition it updates. Recommendation numbers and evidence levels for pancreas, breast and metastatic NSCLC were taken from ESMO's open-access Pan-Asian adaptations, which reproduce the original recommendations. Clinicians must check them (and the national ČOS guidelines) before clinical use.
- **No logins:** the workspace choice and the KOC switcher stand in for authentication. The GP sees "their" referrals by name. There are no real emails (Outbox) and no hospital-system integration.
- **Only one real sample patient exists** (pancreatic). `seed_cancer_demos` adds short synthetic lung and breast cases for demonstration.
- **The body map is coarse.** The anatomogram has one shape per organ: no lobes or lymph-node stations, and the vessel shape is the whole arterial tree. Sides are shown as text. Some organs are only drawn in one of the figures.
- **A 4B LLM is small and Czech is not its main language.** That's why rules come first, quotes are checked, citations are grounded deterministically, and every value is confirmed by a person. GraphRAG answers take ~10–20 s on an RTX 3060 (6 GB).
- The ICD-10 code of the confirmed diagnosis is taken from the GP's suspected diagnosis and marked "to verify at MDT".
- The IRIS address is a WSL IP that can change after a reboot. Update `IRIS_HOST` in `backend/.env`.
- A workflow database created by the Neo4j version still holds names and RČ; the backend refuses to start on it. Run `seed_demo --reset-only` (or delete `backend/data/onkomost.sqlite3`) and seed again.
- Not yet in FHIR: the raw uploads in `storage/raw/`, the LLM cache, generated reports and outbox letters still contain patient names locally.
