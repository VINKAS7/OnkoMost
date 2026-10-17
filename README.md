# Onkomost

Onkomost helps a cancer patient's information travel safely from the family doctor to a cancer centre, through the
team that decides the treatment, and back to the family doctor. Nothing gets lost on the way, and everyone can see
what is done, what is missing and who is next.

It was built for the Rakathon 2026 challenge "Cesta pacienta bez ztráty informací" (the patient's journey without
losing information), set by the Czech health insurer VZP. All patient data in this repository is fictional.

## The problem

When a family doctor suspects cancer, they send the patient to a cancer centre (in Czech: KOC, Komplexní
onkologické centrum). The patient arrives with a pile of reports from different clinics: blood tests, an ultrasound,
a CT scan, letters. A coordinator at the centre has to read all of it, work out which tests are still missing,
chase the clinics for reports, and prepare the case for the multidisciplinary team (MDT), the group of specialists
who decide the treatment. After the meeting, the result has to go back to the family doctor and the insurer.

Today much of this happens by phone, e-mail and paper. Reports get lost, tests get repeated, and the family doctor
often does not hear back.

## What Onkomost does

1. **The family doctor refers the patient.** They type only the patient's name, birth number (rodné číslo) and the
   suspected cancer type, and upload the reports they already have. No long form.
2. **The documents are read automatically.** Simple rules read the parts that always look the same (lab tables,
   dates, diagnosis codes). A language model reads the free text (symptoms, medication, history). Every value keeps
   the exact sentence it came from, so a person can check it.
3. **The case is compared with the cancer pathway.** Each cancer type has a pathway: the list of tests and steps
   a patient needs before the MDT, based on the ESMO clinical guidelines. Each step shows green (we have the report),
   red (it is missing) or yellow (two reports contradict each other). Missing reports become tasks with an owner and
   a deadline.
4. **The coordinator prepares the case.** They request missing reports, book tests, check conflicts and ask the
   family doctor questions. A doctor at the centre confirms the handover, the structured summary for the MDT.
5. **The MDT decides.** The team sees a body map of the affected organs, a case brief, warnings, and can ask
   questions about the case in plain language ("What is the CA 19-9?"). Every answer cites the report it comes from.
   They can download a summary of the patient (an editable Word file with tables and charts) to discuss, and they
   record the decision.
6. **The result goes back.** The family doctor gets the MDT record and confirms receipt. The insurer's review doctor
   gets a summary and can ask for more information. The case is handed to the treatment coordinator and closed.

The app has three workspaces, one for each role:

- **Referring doctor** (`/gp`): send a referral, follow its status, read the result, confirm receipt.
- **Cancer centre** (`/koc`): the patient list, each patient's pathway, tasks, documents, handover, messages, the
  result to send, and voting on changes to the pathways.
- **MDT meeting** (`/mdt`): body map, case brief, questions about the case, original documents, the summary
  download, and the decision to treat.

The whole interface works in English and Czech.

### Shared pathways and voting

Every cancer centre in the country uses the same pathway for a given cancer type, so a patient gets the same work-up
wherever they go. A centre can propose a change (for example, adding a genetic test). The change is put to a vote
and passes only when more than half of all centres vote yes before the deadline. New referrals then use the new
version; patients already on the old version keep it. The project comes with pathways for lung, pancreatic and
breast cancer. They follow ESMO guidelines but have not been validated by clinicians.

## How InterSystems IRIS is used

All patient data lives in one InterSystems IRIS for Health server. IRIS is a database from InterSystems that
combines several kinds of storage in one product, and Onkomost uses four of them. The free Community edition is
enough; it runs in Docker (see `infra/iris`).

| IRIS feature | What Onkomost keeps there | Why |
|---|---|---|
| FHIR R4 server | Who the patient is, and the documents themselves | See the next section |
| Globals | The patient graph: every fact (diagnosis, test, lab value, medication) linked to the report it came from | Fast, flexible storage that fits a graph |
| SQL with a VECTOR column | The report text cut into short pieces, with an embedding for each piece | Search by meaning inside the same database |
| Python driver (SQL and native API) | The connection from the backend | One driver for SQL and globals |

**Globals** are IRIS's native storage: sorted, multi-level keys, a bit like a very large nested dictionary that is
saved to disk and supports transactions. Onkomost stores one small graph per patient under the global `^OnkGraph`:
the patient, their documents, the facts read from each document, and warnings such as two dates that contradict
each other. Each fact points to the documents and sentences that state it. The cancer pathway check is a set of
fixed queries over this graph, so the green, red and yellow colours come from rules, not from the language model.
This follows the [IRIS-Global-GraphRAG](https://github.com/fanji-isc/IRIS-Global-GraphRAG) pattern.

**Vector search in SQL.** Each report is split into short pieces and stored in the SQL table `Onk.DocChunk`
together with an embedding, a list of numbers that captures the meaning of the text. IRIS can compare these vectors
directly in SQL (`VECTOR_COSINE`), so a question in English finds the right passage in a Czech report. Because it is
ordinary SQL, the same query also limits the search to one patient and to reports dated before the MDT meeting.
There is no separate vector database to run. This follows
[iris-vector-rag](https://github.com/intersystems-community/iris-vector-rag).

Onkomost only touches its own data: the global `^OnkGraph`, the table `Onk.DocChunk` and FHIR resources tagged
`onkomost`. A test checks that nothing else on the server changes.

## Where FHIR is used, and why

FHIR (Fast Healthcare Interoperability Resources) is the international standard for exchanging health data. IRIS
for Health includes a FHIR R4 server, and Onkomost uses it for everything that identifies a patient:

- **Patient**: name, birth number, birth date, sex, insurer, address and phone.
- **RelatedPerson**: contact persons, such as a daughter the patient allowed us to inform.
- **DocumentReference**: each received report, with its text and the original file.

There are two reasons for this:

1. **Privacy by separation.** The identity of the patient is kept in one place. The patient graph, the search
   index and the workflow database only know a random patient ID. Names and birth numbers are also masked in the
   text that is indexed for search. If someone gets access to the analytics data, they cannot tell who the patient
   is.
2. **Hospitals already speak FHIR.** Any FHIR-capable system can read the patient and the documents from the
   standard endpoint (`/fhir/r4`) without knowing anything about Onkomost. This is how the platform would connect to
   real hospital systems later.

The FHIR server is set up the same way as in the
[FHIR-AI-Hackathon-Kit](https://github.com/intersystems-community/FHIR-AI-Hackathon-Kit/tree/V2).

## How the AI is used

The rule is simple: **AI prepares, people decide.** The language model reads free text, drafts letters, suggests
the treatment from an imported MDT conclusion and answers questions about the case. It never decides anything on
its own.

- Every value it extracts must come with a quote from the report. If the quote is not found in the report, the
  value is marked for checking.
- A doctor confirms the handover, and the MDT confirms the decision.
- Anything with a fixed format (lab tables, codes, dates) is read by rules, not by the model.
- Missing data is reported as missing, never guessed.
- Only reports dated on or before the MDT date are used, so the team sees the case as it was on the day.

Questions about a case go through three steps:

1. **Find candidates.** Keyword search (BM25 with light Czech word stemming) and vector search on the question run
   side by side in IRIS, and their results are merged.
2. **Rerank.** A reranker model reads each candidate together with the question and keeps the best ones.
3. **Answer.** The language model answers only from those passages and the patient graph, and cites each report as
   `[D12]`. A final check makes sure the cited report really contains the answer; otherwise the answer is marked as
   not backed by a document.

The models run behind any OpenAI-compatible API. The default setup uses the
[e-INFRA CZ](https://llm.ai.e-infra.cz/status/) service:

| Job | Model |
|---|---|
| Reading reports, answering questions | `deepseek-v4.1-flash` |
| Embeddings for search | `qwen3-embedding-4b` |
| Reranking search results | `qwen3-reranker-4b` |

You can switch to another provider, or to a local [Ollama](https://ollama.com), by changing `backend/.env`.

## Getting started

### What you need

- Docker (Docker Desktop on Windows and macOS)
- Python 3.10 or newer
- Node.js 18 or newer
- An API key for an OpenAI-compatible model service (for example e-INFRA CZ)
- About 5 GB of disk space for the IRIS image
- Optional: the Rakathon sample data, for the full demo story and the tests

### 1. Install

```bash
git clone https://github.com/VINKAS7/OnkoMost.git
cd OnkoMost

python -m venv .venv
source .venv/bin/activate          # on Windows: .venv\Scripts\activate
pip install -r requirements.txt

cd frontend
npm install                        # also copies the body map pictures into public/
npm run build
cd ..
```

### 2. Configure

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and set at least:

- `LLM_API_KEY`: your API key.
- `IRIS_PASSWORD`: any password you like. The start script in the next step sets it on the IRIS server.
- `SAMPLE_DATA_DIR`: the folder with the Rakathon sample data, if you have it.

### 3. Start IRIS

```bash
bash infra/iris/start.sh
```

On Windows, run this from Git Bash or WSL. The script builds and starts the IRIS for Health container (ports 1972
and 52773), sets the password, creates the `ONKOMOST` namespace and installs the FHIR server. The first run takes a
few minutes; running it again is safe.

If Docker runs inside WSL rather than Docker Desktop, set `IRIS_HOST` in `backend/.env` to the WSL address
(`hostname -I` inside WSL). This address can change after a restart.

### 4. Check that everything is reachable

```bash
python -m backend.config --check
```

This tests IRIS, the FHIR server, the language model, the embeddings, the reranker, the workflow database and the
sample data, and prints `[ok]` or `[FAIL]` for each.

### 5. Load example patients

```bash
python -m scripts.seed_demo                      # the Rakathon sample patient, from referral to closed case
python -m scripts.seed_demo --until histology    # or stop earlier, with the case still in progress
python -m scripts.seed_cancer_demos --bodymap    # two more example patients (lung and breast cancer)
```

`seed_demo` replays the sample case day by day and needs the Rakathon sample data. It starts by wiping Onkomost's
data. `seed_cancer_demos` generates its own reports, so it also works without the sample data.

The app has a demo date, shown in the top bar, so that deadlines make sense for the example story (October 2026).
The seed scripts set it, and you can change it at any time.

### 6. Run

```bash
uvicorn backend.api:app --port 8000
```

Open <http://localhost:8000>. The backend also serves the built interface.

For frontend work with live reload, run `npm run dev` in `frontend/` and open <http://localhost:5173>. It forwards
API calls to port 8000.

### Using a different model provider

All model settings are in `backend/.env`. For a local Ollama:

```
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=
LLM_MODEL=qwen3:8b
LLM_REASONING_EFFORT=
EMBED_MODEL=qwen3-embedding:0.6b
EMBED_DIM=1024
RERANK_MODEL=
```

When the embedding model or its size changes, the search index is rebuilt and the stored text is embedded again on
the next start.

## Tests

```bash
python -m pytest tests -q
```

There are 45 tests. They need IRIS to be running and the Rakathon sample data; without the sample data they are
skipped. They check, among other things:

- the extraction rules and the birth number check
- that a document belonging to another patient is blocked
- the answers from the challenge's answer key (for example CA 19-9 = 312, grade G2 to G3, ICD-10 C25.0)
- the green, red and yellow pathway status
- that reports dated after the MDT are never used
- that questions about the case find the right report
- the voting rules for pathway changes
- the body map checks
- the MDT summary download
- that names and birth numbers exist only in FHIR, and that other data on the FHIR server is never changed

The tests use their own workflow database but rebuild Onkomost's data in IRIS, so run `seed_demo` again afterwards.

## A short demo

Run `python -m scripts.seed_demo --until histology` first. The sample patient then has all tests done and two
conflicting dates waiting for review.

1. **Start page.** Show the three workspaces and switch between English and Czech.
2. **Referring doctor.** Show the short referral form and the list of the doctor's referrals with their status.
3. **Cancer centre, patient Alena, Pathway tab.** The pancreatic cancer pathway in colour: CT, biopsy, histology
   and tumour markers are green; the biopsy and histology reports are yellow because their dates contradict each
   other. Mark the conflicts as reviewed, ask the family doctor a question, validate the handover.
4. **Cancer pathways, Lung.** Open any step to see what it needs, why it is there (the ESMO recommendation and its
   evidence level) and which file formats count.
5. **MDT, patient Alena.** Click the pancreas on the body map to filter the reports. Ask "What is the CA 19-9?"
   and open the cited report. Download the patient summary. Import the signed MDT conclusion (`MDT zaver.docx`) and
   record the decision.
6. **Cancer centre, MDT and result.** Send the result to the family doctor and the insurer's review doctor.
7. **Referring doctor.** Confirm receipt. The case is handed over and closed.
8. **Voting.** Propose a new pathway step and vote yes as four of the six centres; the new version becomes active.

## Project layout

```
backend/
  api.py          the web API; also serves the built frontend
  config.py       settings from backend/.env, and the --check command
  iris.py         the shared connection to IRIS (SQL and globals)
  fhir/           the FHIR client and the mapping of patients, contacts and documents
  graph/          the patient graph in IRIS globals
  rag/            search over the reports and answers to questions about a case
  ingest/         reading .docx files (and scans with OCR), recognising the document type, birth number checks
  extract/        rules and the language model that turn reports into facts
  pathway/        pathways, the comparison with a patient's case, and voting
  reports/        handover, MDT record, MDT summary download, letters, body map
  workflow/       cases, tasks, messages, states and the audit trail
frontend/src/     the React interface (English and Czech texts in i18n.ts)
seed/             the six example cancer centres and the three cancer pathways
scripts/          the demo story and the two extra example patients
example/          two more fictional lung cancer patients (reports and CT images) to upload by hand
infra/iris/       Docker setup and start script for IRIS for Health
tests/            the test suite
storage/          original uploads, the language model cache and generated documents (created on first run)
```

## Known limits

- **This is a prototype.** The pathways follow ESMO guidelines but must be checked by clinicians (and against the
  Czech national guidelines) before any real use.
- **There are no logins.** Choosing a workspace and a cancer centre stands in for authentication. Messages are
  shown in an outbox instead of being e-mailed.
- **There is only one real sample patient** (pancreatic cancer). The other example patients are short synthetic
  cases.
- **The body map is coarse.** It has one shape per organ, with no lung lobes or lymph node stations.
- **The models run on an external service.** The app needs the network and an API key, and report text is sent to
  the service when it is read. Names and birth numbers are masked only in the search index.
- **Some files outside FHIR still contain names:** the original uploads in `storage/raw/`, the language model
  cache, generated documents and outbox letters.

## Credits

- Body map: [EBI Expression Atlas anatomogram](https://github.com/gxa/anatomogram), CC BY 4.0.
- Clinical content: ESMO Clinical Practice Guidelines ([esmo.org/guidelines](https://www.esmo.org/guidelines)).
- IRIS patterns: [IRIS-Global-GraphRAG](https://github.com/fanji-isc/IRIS-Global-GraphRAG),
  [iris-vector-rag](https://github.com/intersystems-community/iris-vector-rag) and the
  [FHIR-AI-Hackathon-Kit](https://github.com/intersystems-community/FHIR-AI-Hackathon-Kit/tree/V2).
- Sample patient: Rakathon 2026 challenge data.
