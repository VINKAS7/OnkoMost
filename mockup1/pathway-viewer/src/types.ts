// Pathway JSON (seed/pathways/diagnostic/*.json, format onkomost.diagnostic-pathway/0.1).
// The older full pathways (seed/pathways/*.json) are a subset of this and load too.

export type Level = "required" | "recommended" | "optional" | "individual" | "conditional";
export type Role = "binding" | "structure" | "local";

export interface Cond {
  all?: Cond[];
  any?: Cond[];
  not?: Cond;
  else?: boolean;
  fact?: string;
  eq?: unknown;
  in?: unknown[];
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export interface SourceRef {
  ref: string;
  role: Role;
  section?: string;
  quote?: string;
  note?: string;
}

export interface SourceDef {
  title: string;
  publisher?: string;
  edition?: string;
  url?: string;
  fetched?: string;
  checked?: string;
  note?: string;
  default_role?: Role;
}

export interface FactDef {
  type: "bool" | "number" | "enum";
  label: string;
  unit?: string;
  values?: string[];
  from?: string[];
  derived?: Cond;
}

export interface Branch {
  key: string;
  label: string;
  label_en?: string;
  when?: Cond;
}

export interface PNode {
  id: string;
  type: string; // start | step | decision | mdt | end | treatment | feedback | handover
  kind?: string;
  level?: Level;
  label: string;
  label_en?: string;
  phase?: string;
  owner_role?: string;
  sla_days?: number;
  completion?: string;
  requires?: Record<string, unknown>[];
  produces?: string[];
  condition?: Cond;
  level_rules?: { when: Cond; level: Level }[];
  branches?: Branch[];
  multi?: boolean;
  decided_by?: "rule" | "clinician";
  suggest?: string;
  branch?: string | null;
  branch_in?: string[];
  blocking?: boolean;
  waiver?: { when: Cond; label: string; label_en?: string; confirmed_by?: string; sources?: SourceRef[] };
  description?: string;
  group?: string;
  sources?: SourceRef[];
}

export interface PEdge {
  source: string;
  target: string;
  kind?: string;
  label?: string;
  branch?: string | null;
  branches?: string[];
}

export interface Pathway {
  format?: string;
  code: string;
  scope?: string;
  status?: string;
  name: string;
  name_en?: string;
  icd_codes?: string[];
  summary?: string;
  notes?: string[];
  guideline_source?: string;
  sources?: Record<string, SourceDef>;
  facts?: Record<string, FactDef>;
  graph: { nodes: PNode[]; edges: PEdge[] };
}

/** What the user records for a case: document status per step, chosen decision branches, known facts. */
export type ManualStatus = "missing" | "in_progress" | "done" | "conflict";
export type FactValue = boolean | number | string;

export interface CaseState {
  nodes: Record<string, ManualStatus>;
  decisions: Record<string, string[]>;
  facts: Record<string, FactValue>;
}

export const emptyState = (): CaseState => ({ nodes: {}, decisions: {}, facts: {} });
