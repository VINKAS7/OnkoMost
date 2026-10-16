// Shapes returned by backend/api.py (keep in sync with backend/workflow/service.py).

export type Koc = { id: number; code: string; name: string; city: string; coordinator_name: string; active: boolean };

export type Health = { neo4j: string; medgemma: boolean; model: string; today: string; queue: number };

export type Task = {
  id: number; key: string; kind: "to_schedule" | "action" | "decision" | "missing_document" | "mismatch" | "missing_field" | "question";
  title: string; detail: string; title_en: string; detail_en: string; node_id: string; owner_role: string; owner_role_label: string; owner_name: string;
  external: boolean; priority: "high" | "normal" | "low"; due_on: string | null; overdue: boolean;
  status: "open" | "scheduled" | "done" | "dismissed"; scheduled_on: string | null; scheduled_place: string;
  created_on: string; closed_on: string | null; resolution: string;
};

export type CaseSummary = {
  id: number; patient_uuid: string; patient_name: string; rc: string; dob: string | null;
  koc: { id: number; code: string; name: string };
  pathway: { id: number; name: string; name_en: string; code: string; version: number; version_id: number };
  suspected_diagnosis: string; referring_doctor: Record<string, string>;
  created_on: string; accepted_on: string | null; mdt_date: string | null; closed_on: string | null;
  decisions: Record<string, { keys: string[]; on: string; by: string }>; treatments: string[];
  doc_counts: { have?: number; missing?: number; conflict?: number; conditional?: number; skipped?: number };
  feedback?: Message | null; documents_count?: number; thread?: CaseMessage[];
  state: string; state_index: number; queue: "new" | "active" | "on_hold" | "closed";
  next_task: Task | null; open_tasks: number; overdue_tasks: number; days_since_referral: number;
};

export type Requirement = Record<string, unknown> & { kind: string };

export type PathwayNode = {
  id: string; type: string; label: string; label_en?: string; phase?: string; owner_role?: string; sla_days?: number;
  completion?: string; requires?: Requirement[]; skip_if?: Requirement[];
  branches?: { key: string; label: string; label_en?: string }[]; multi?: boolean;
  branch?: string | null; blocking?: boolean; action?: string; description?: string;
  // filled in for a case:
  status?: "done" | "available" | "blocked" | "skipped"; done_on?: string | null; due_on?: string | null;
  available_on?: string | null; owner_name?: string;
  evidence?: { doc_id: number; title: string; date: string; quote: string }[];
  detail?: { items?: unknown[]; missing?: { label: string; date: string; place: string }[]; keys?: string[] };
  doc_status?: "have" | "missing" | "conflict" | "conditional" | "skipped" | null;
  conflicts?: { key: string; doc_id: number; title: string; message: string; message_en: string; reviewed: boolean }[];
  conditional?: boolean;
};
export type PathwayEdge = { source: string; target: string; label?: string; branch?: string | null };
export type PathwayGraph = { nodes: PathwayNode[]; edges: PathwayEdge[] };

export type Finding = {
  key: string; kind: string; title: string; detail: string; title_en?: string; detail_en?: string; node_id: string; owner_role: string; priority: string;
  due_on: string | null; doc_id?: number; quote?: string; facility?: string; item?: string; item_date?: string;
  reviewed?: { note: string; by: string; on: string } | null;
};

export type DocumentRow = {
  id: number; filename: string; source: string; status: string; error: string; doc_type: string; title: string;
  doc_date: string | null; facility: string; author: string;
  identity: { ok?: boolean; issues?: string[]; matched_on?: string[] };
  summary: { facts?: Record<string, number>; unverified?: number; medgemma_items?: number; llm_calls?: number;
             llm_errors?: string[]; flags?: number };
  uploaded_on: string; post_mdt: boolean;
};

export type Message = {
  id: number; case_id: number | null; kind: string; to_name: string; to_role: string; to_address: string;
  subject: string; body: string; attachments: { name: string; document_id?: number; report_path?: string; text?: string }[];
  sent_on: string; ack_token: string | null; acked_on: string | null; acked_by: string;
};

export type MdtConclusion = {
  diagnosis: string; conclusion: string; recommendations: string[]; next_appointment: string | null;
  treatments: string[]; members: string[]; document_id?: number | null; recorded_by?: string; recorded_on?: string;
};
export type MdtImport = {
  date: string | null; diagnosis: string; conclusion: string; recommendations: string[]; next_appointment: string | null;
  suggested_treatments: string[]; method: string | null; members: string[]; document_id: number;
};
export type AskResult = {
  question: string; answer: string; translation?: string | null; terms: string[]; cutoff: string; grounded: boolean;
  sources: { doc_id: number; title: string; date: string; snippets: string[]; cited: boolean }[];
};

export type CaseDetail = CaseSummary & {
  states: { key: string; label: string; label_en: string }[];
  pathway_graph: PathwayGraph; tasks: Task[]; documents: DocumentRow[];
  doc_requests: { id: number; key: string; facility: string; item: string; item_date: string; status: string;
                  requested_on: string; received_on: string | null; message_id: number | null }[];
  findings: Finding[]; messages: Message[]; events: { node_id: string; on: string; by: string }[];
  mdt_conclusion: MdtConclusion | null; mdt_report_ready: boolean; pre_mdt_complete: boolean; today: string;
};

export type Source = { doc_id: number | null; title: string; date: string | null; facility?: string; quote: string;
                       match: "exact" | "approx" | null; method: "rule" | "medgemma" | "coordinator" | null };
export type HandoverItem = { text: string; sources: Source[]; verified: boolean; added_by?: string; edited_by?: string;
                             rows?: { analyte: string; value: string; unit: string; ref: string; flag: string | null;
                                      is_tumor_marker: boolean; panel: string }[]; result?: string };
export type HandoverField = { key: string; section: string; label: string; label_en: string; items: HandoverItem[];
                              required: boolean; note: string; note_en: string; confirmed: boolean; confirmed_by: string | null;
                              status: "ok" | "missing" | "unverified"; text: string };
export type Handover = {
  cutoff: string; sections: { key: string; label: string; label_en: string; fields: HandoverField[] }[];
  missing: { key: string; label: string; label_en: string; note: string; note_en: string; required: boolean }[];
  unverified: { key: string; label: string; label_en: string }[]; confirmed_count: number; field_count: number; text: string;
  validated: boolean;
};

export type MdtReport = {
  mdt_date: string; koc: string;
  patient: Record<string, string>; referring_doctor: Record<string, string>;
  members: { name: string; role: string }[];
  diagnosis: { name: string; icd10: string; note: string };
  comorbidities: string[]; results: { date: string; exam: string; result: string; doc_id: number | null }[];
  performance_status: string; mdt_question: string; notes: string[];
  missing: { key: string; label: string }[]; excluded_documents: { title: string; date: string }[];
};

export type GraphView = {
  nodes: { id: string; kind: string; label: string; props: Record<string, unknown> }[];
  edges: { source: string; target: string; label: string }[];
};

export type PathwayInfo = {
  id: number; code: string; name: string; name_en: string; cancer_type: string; icd_codes: string[]; guideline_source: string;
  active_version_id: number | null;
  versions: { id: number; version: number; status: string; created_by_koc_id: number | null; created_at: string;
              activated_at: string | null }[];
};
export type PathwayVersion = { id: number; pathway_id: number; pathway: string; pathway_en: string; version: number; status: string;
                               graph: PathwayGraph; based_on_version_id: number | null; created_by_koc_id: number | null };

export type Proposal = {
  id: number; pathway_id: number; pathway: string; title: string; rationale: string; author: string; author_koc_id: number;
  deadline: string; status: string; created_at: string; closed_at: string | null; base_version: number;
  draft_version: number; draft_version_id: number; base_graph: PathwayGraph; draft_graph: PathwayGraph;
  diff: { added_nodes: string[]; removed_nodes: string[]; changed_nodes: { id: string; fields: string[];
          before: Record<string, unknown>; after: Record<string, unknown> }[]; added_edges: string[]; removed_edges: string[] };
  votes: { koc_id: number; koc: string; choice: string; comment: string; at: string }[];
  tally: { yes: number; no: number; abstain: number; not_voted: number; total_kocs: number; needed: number; status: string };
};

export type CaseMessage = {
  id: number; author_role: "coordinator" | "gp" | "review"; author: string; to_role: "gp" | "coordinator" | "review";
  body: string; reply_to: number | null; resolved: boolean; on: string; at: string;
};
export type Notification = {
  case_id: number; patient: string; task_id: number; title: string; title_en: string; kind: string;
  due_on: string | null; level: "overdue" | "due_soon" | "question"; owner_name: string; external: boolean;
};

export type BodyStatus = "primary" | "metastasis" | "involved" | "suspicious" | "negative";
export type BodySite = {
  organ: string; uberon: string[]; label: string; label_en: string; status: BodyStatus;
  side: "left" | "right" | "both" | null; conflict: boolean; from_pathway: boolean;
  evidence: { organ: string; status: BodyStatus; side: string | null; quote: string; match: string; doc_id: number;
              title: string; date: string | null }[];
};
export type BodyMap = {
  job: { status: "idle" | "running" | "done" | "error"; done: number; total: number; error: string };
  result: { computed_on: string; cutoff: string; model: string; sex: string | null; pathway: string;
            documents: { id: number; title: string; date: string | null }[]; sites: BodySite[] } | null;
  stale: boolean; sex: "male" | "female" | null; pathway: string;
};
