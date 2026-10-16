# Onkomost (OncoBridge)

**A shared platform for Czech cancer centres (KOC) that takes a patient from the GP's referral to the MDT decision and back to the GP, without losing information.**

Built for the Rakathon 2026 challenge *"Cesta pacienta bez ztráty informací"* (*The patient's journey without losing information*). The challenge itself is explained in plain English in `…/cesta-pacienta-data/rakathon_final_all/README.md`.

> All patient data is fictional (the Rakathon sample patient *Alena Procházková*).

---

## Three workspaces

| Workspace | Who | What they do |
|---|---|---|
| 🩺 **Referring doctor** (`/gp`) | GP or specialist | Enters only the **patient's name, birth number (RČ) and suspected cancer type**, picks a KOC and uploads the documents they already have. Later sees the case status, the MDT result, and confirms receipt. |
| 🏥 **Cancer centre – KOC** (`/koc`) | Coordinator | Sees each patient **on the pathway for their cancer type** (React Flow). Every step that needs a document is **green** (we have it), **red** (missing) or **yellow** (conflict between documents). Also: next steps with owners and deadlines, handover, documents, Neo4j graph, sending the result, and **voting on pathway changes**. |
| ⚕️ **MDT meeting** (`/mdt`) | Multidisciplinary team | Case brief, warnings, **"Ask the case" (GraphRAG)** with cited sources, a sidebar of **original documents to download**, and the **decision to treat**: active monitoring / palliative care / chemotherapy / radiotherapy / surgery (more than one can be chosen). |

The whole UI switches between **English and Czech** (EN | CS in the sidebar). The design is minimal: no icons or emoji, status shown as small coloured dots.

```
GP: name + RČ + cancer type + documents
        │
        ▼
raw files stored unchanged ─► identity check (RČ + name + birth date) ─► rules + MedGemma extract facts with quotes
        │
        ▼
Neo4j patient graph (patient → facts → documents) + document chunks in a Czech full-text index
        │
        ▼
KOC: patient graph vs. the cancer's pathway (fixed Cypher queries, no AI)
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

### Cancer pathways (one per cancer type)

| Pathway | ICD-10 | Source |
|---|---|---|
| 🫁 Lung cancer | C34 | Follows the "current lung cancer pathway" flowchart: referral → triage → CT → diagnostic MDT → outpatient → **curative** (PET-CT → biopsy/EBUS → MRI) / **non-radical** (biopsy → MRI) / **no biopsy** → treatment MDT → decision to treat |
| 🧬 Pancreatic cancer | C25 | Built from the Rakathon sample case (CT pancreatic protocol, anticoagulant pause, EUS-FNB, histology, CA 19-9, supportive care) |
| 🩻 Colorectal cancer | C18–C20 | Draft skeleton (colonoscopy + histology, staging CT, pelvic MRI, CEA) |
| 🎗️ Breast cancer | C50 | Draft skeleton (mammography + ultrasound, core biopsy, staging) |

All four are **drafts for clinicians to validate** against the ČOS guidelines. They live in `seed/pathways/*.json`. Colorectal and breast reuse a standard ending (handover → treatment MDT → decision to treat with 5 options → feedback → K2 → closed). Steps after a decision (e.g. lung PET-CT) are shown as **"depends on decision"** until the route is chosen, then become required or "not needed".

**National governance.** Every KOC uses the same pathway per cancer type. A change is made in a **draft** and the draft is put to a vote. It passes only with **YES from more than half of all KOCs** (not only of those who voted) before the deadline. New referrals use the new version. Running cases stay on the version they started with.

## Design rules

1. **AI prepares, people decide.** MedGemma only turns short free-text sections into lists, drafts request letters, suggests treatments from an imported MDT conclusion, and answers GraphRAG questions. Every extracted value keeps its source quote. If the quote isn't found in the document, the value is marked "check source". A doctor confirms the handover and the MDT confirms the decision.
2. **The comparison with the pathway is not done by the LLM.** Every pathway step has a machine-readable `requires` list (e.g. `{"kind": "exam", "exam_type": "ct"}`), and each one is checked by a Cypher query. That is what drives green / red / yellow.
3. **GraphRAG without an extra embedding model** (the machine has little free RAM):
   - MedGemma turns the question (EN or CS) into Czech search terms.
   - A **Neo4j full-text index with the Czech analyzer** finds document chunks; the graph adds the core facts (diagnosis, exam conclusions, abnormal labs).
   - MedGemma answers through a JSON schema and cites `[D<id>]`.
   - Citations are also matched deterministically. If nothing backs the answer, it is flagged "not backed by a document".
   - It never concludes something is absent just because it isn't mentioned (e.g. "no MRI in the documents" rather than "no metastases on MRI").
4. **Copy, don't guess.** Fixed-shape data is read by rules, with no LLM: header, OA/FA/AA lines, lab tables, ICD codes, dates, weight/height. Missing data is reported as missing.
5. **Time-aware.** Every fact keeps its document date. Only documents dated on or before the MDT date are searchable and used in the MDT report.

## Tech stack

| Part | Choice |
|---|---|
| Backend | Python 3.10 (conda env `Deep_Learning`), FastAPI, SQLAlchemy |
| Workflow data | SQLite (`backend/data/onkomost.sqlite3`); switch to Postgres by changing `SQLITE_URL` |
| Patient graph | Neo4j 2026.04. **Every node has the label `:Onk`**, and nothing outside `:Onk` is touched (the database is shared with another project). Czech full-text index `onk_chunk_text` |
| AI | MedGemma 4B (`medgemma:4b`) via the local Windows Ollama, JSON-schema output, temperature 0, answers cached in `storage/llm_cache/` |
| Frontend | React 18 + Vite + TypeScript, React Flow (`@xyflow/react`) + dagre, EN/CS dictionary in `src/i18n.ts` |
| Documents | python-docx; optional Tesseract OCR (`ces`) for scans |

## Run it

All commands run from this folder (`onkomost/`). On Windows use `conda run`, because non-interactive shells cannot `conda activate`. In an interactive terminal, `conda activate Deep_Learning` works too.

```bash
# 0. one-time setup
cp backend/.env.example backend/.env            # then fill in NEO4J_PASSWORD (and NEO4J_URI if the WSL IP changed)
ollama pull medgemma:4b                         # ~3.3 GB, local Ollama (not WSL)
cd frontend && npm install && npm run build && cd ..

# 1. check Neo4j, Ollama/MedGemma, SQLite and the sample data
conda run -n Deep_Learning python -m backend.config --check

# 2. load the sample case (pick where the story should stop)
conda run -n Deep_Learning python -m scripts.seed_demo --until histology    # diagnostics done, conflicts open
conda run -n Deep_Learning python -m scripts.seed_demo                      # whole story, ends closed

# 3. start (serves the built UI too) → http://localhost:8000
conda run -n Deep_Learning uvicorn backend.api:app --port 8000

# frontend dev server with hot reload → http://localhost:5173 (proxies /api to :8000)
cd frontend && npm run dev
```

`seed_demo` steps: `referral, accepted, prior_reports, ct, biopsy, labs, histology, ready, mdt, feedback, closed`.
It sets the **demo date** to the date of each event (the sample case happens in October 2026). You can change the demo date in the top bar.

> Memory: MedGemma takes ~4.5 GB when loaded. On a machine with little free RAM, close other heavy programs before starting the server.

### Tests

```bash
conda run -n Deep_Learning python -m pytest tests -q
```

There are 18 tests. Among other things they check:
- extraction rules
- the RČ / identity check
- missing reports found from the referral alone
- a wrong-patient document gets blocked
- the **answer key** (`MDT zaver.docx`): CA 19-9 = 312, G2–G3, C25.0, CT 35 mm, the 3 comorbidities, 7 MDT members, ECOG missing, both impossible dates flagged, post-MDT reports excluded
- green / red / yellow document status on the pathway
- the lung route decision (PET-CT "depends on decision", then skipped for non-radical; single choice enforced)
- GraphRAG finds CA 19-9 = 312 and cannot see the post-MDT pain report
- the feedback loop closes the case (MDT chose chemotherapy)
- the final MDT record contains the conclusion, the recommendations and the decision, and is attached to the GP message even without an imported .docx
- a question to the GP creates a waiting task that closes when the GP replies or uploads a document
- a review-doctor question creates a high-priority coordinator task and appears in notifications
- notifications list overdue tasks per centre
- governance (3 of 6 yes → rejected, 4 of 6 → active, a running case keeps v1)
- **non-Onkomost Neo4j data is unchanged**

The tests use their own SQLite file, but they rebuild the `:Onk` nodes in Neo4j. Re-run `seed_demo` afterwards.

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
   - Validate the **Handover** (sources marked AI were read by MedGemma), and generate the MDT briefing under **MDT & result**.
4. **🗺️ Cancer pathways → Lung** – the flowchart from the brief, with the curative / non-radical / no-biopsy route.
5. **⚕️ MDT → Alena**:
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
  seed.py                KOCs + cancer pathways (standard MDT ending for skeleton pathways)
  ingest/                reader (docx/OCR, sections, header), classify, identity (RČ)
  extract/               pipeline (rules + MedGemma), labs, schemas, verify (quote check), medgemma (Ollama client + cache)
  rag/ask.py             GraphRAG: Czech full-text over document chunks + graph facts → MedGemma answer with citations
  graph/store.py         Neo4j writes/reads, :Onk scoped
  pathway/               model (JSON + validation + diff), conformance (Cypher checks → green/red/yellow + findings),
                         governance (votes)
  reports/               handover (Handover_obsah, EN labels), mdt (MDT_zapis .docx + conclusion parsing + treatment
                         suggestion), feedback (messages)
  workflow/              db (SQLAlchemy models, demo clock, audit), service (cases, tasks, decisions, states, actions)
frontend/src/            React app: i18n.ts (EN/CS), pages/gp (GP portal), pages/koc (patients, case tabs, pathways,
                         editor, proposals, outbox), pages/mdt (meetings, workspace with GraphRAG + decision), AckPage
seed/                    kocs.json (6 fictional KOCs), pathways/*.json (lung, pancreas, colorectal, breast)
scripts/seed_demo.py     replays the Rakathon sample case day by day
tests/                   pytest suite
storage/                 raw/ (immutable originals), llm_cache/, reports/ (generated .docx)
```

## Known limits (prototype)

- **The pathways are drafts.** Lung follows the published flowchart; pancreas is derived from the sample case; colorectal and breast are skeletons. All must be checked by clinicians against the ČOS guidelines.
- **No logins:** the workspace choice and the KOC switcher stand in for authentication. The GP sees "their" referrals by name. There are no real emails (Outbox) and no hospital-system integration.
- **Only one sample patient exists** (pancreatic). The other pathways can be shown and used with your own test documents.
- **MedGemma 4B is small and Czech is not its main language.** That's why rules come first, quotes are checked, citations are grounded deterministically, and every value is confirmed by a person. GraphRAG answers take ~10–20 s on an RTX 3060 (6 GB).
- The ICD-10 code of the confirmed diagnosis is taken from the GP's suspected diagnosis and marked "to verify at MDT".
- The Neo4j address is a WSL IP that can change after a reboot. Update `NEO4J_URI` in `backend/.env`.
