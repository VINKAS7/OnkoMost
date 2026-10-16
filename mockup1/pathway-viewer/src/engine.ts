/**
 * Pathway + case state → what each step means right now. Deterministic, no AI.
 *
 * Three independent questions per step:
 *   flow   – is the step on the patient's route?  ok | unknown (a decision before it is open) | pruned (other branch)
 *   cond   – does its `condition` hold?            true | false (not needed, flow passes through) | null (fact unknown)
 *   level  – how strongly is it needed?            level_rules → level; "conditional" → required when cond holds;
 *                                                  a step backed only by `structure` sources is never required
 * Then: a missing step is RED when it is required + blocking, otherwise GREY.
 */
import type { CaseState, Cond, FactValue, Level, PEdge, PNode, Pathway } from "./types";

export type Tri = boolean | null;
export type Flow = "ok" | "unknown" | "pruned";
export type EffLevel = Exclude<Level, "conditional">;
export type VState =
  | "done" | "in_progress" | "conflict" | "waived"
  | "missing_needed" | "missing_optional" | "undetermined" | "skipped" | "pruned"
  | "decided" | "undecided" | "pending" | "gate_ready" | "gate_waiting";
export type EdgeStyle = "done" | "active" | "needed" | "open" | "conflict" | "optional" | "pending" | "pruned";

export interface NodeEval {
  id: string;
  flow: Flow;
  cond: Tri;
  level: EffLevel | null;
  downgraded: boolean; // required → recommended because only structure sources back it
  waived: boolean;
  vstate: VState;
  chosen: string[] | null;
  autoChosen: boolean;
  gates: string[]; // mdt / end nodes downstream (this step must be finished before them)
  blockers: string[]; // for gates: upstream steps still missing and needed
}

export interface Evaluation {
  facts: Record<string, FactValue>;
  factOrigin: Record<string, "user" | "derived" | "decision">;
  decisionFact: Record<string, string>; // decision id → fact it sets
  nodes: Record<string, NodeEval>;
  edges: { edge: PEdge; flow: Flow; style: EdgeStyle }[];
  red: string[];
  warnings: string[];
}

// ---------------------------------------------------------------- conditions

export function evalCond(c: Cond | undefined, facts: Record<string, FactValue>): Tri {
  if (!c) return true;
  if (c.else) return true;
  if (c.all) {
    let unknown = false;
    for (const x of c.all) {
      const r = evalCond(x, facts);
      if (r === false) return false;
      if (r === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if (c.any) {
    let unknown = false;
    for (const x of c.any) {
      const r = evalCond(x, facts);
      if (r === true) return true;
      if (r === null) unknown = true;
    }
    return unknown ? null : false;
  }
  if (c.not) {
    const r = evalCond(c.not, facts);
    return r === null ? null : !r;
  }
  if (c.fact) {
    const v = facts[c.fact];
    if (v === undefined) return null;
    const checks: boolean[] = [];
    if ("eq" in c) checks.push(v === c.eq);
    if (c.in) checks.push(c.in.includes(v));
    const n = typeof v === "number" ? v : Number.NaN;
    if (c.gt !== undefined) checks.push(n > c.gt);
    if (c.gte !== undefined) checks.push(n >= c.gte);
    if (c.lt !== undefined) checks.push(n < c.lt);
    if (c.lte !== undefined) checks.push(n <= c.lte);
    return checks.length ? checks.every(Boolean) : Boolean(v);
  }
  return true;
}

export function condText(c: Cond | undefined, label: (fact: string) => string, words = { and: "AND", or: "OR", not: "NOT", else: "otherwise" }): string {
  if (!c) return "";
  const sub = (x: Cond) => {
    const t = condText(x, label, words);
    return x.all || x.any ? `(${t})` : t;
  };
  if (c.else) return words.else;
  if (c.all) return c.all.map(sub).join(` ${words.and} `);
  if (c.any) return c.any.map(sub).join(` ${words.or} `);
  if (c.not) return `${words.not} ${sub(c.not)}`;
  if (c.fact) {
    const l = label(c.fact);
    const parts: string[] = [];
    if ("eq" in c) parts.push(c.eq === true ? "" : c.eq === false ? "= ne/no" : `= ${String(c.eq)}`);
    if (c.in) parts.push(`∈ {${c.in.join(", ")}}`);
    if (c.gt !== undefined) parts.push(`> ${c.gt}`);
    if (c.gte !== undefined) parts.push(`≥ ${c.gte}`);
    if (c.lt !== undefined) parts.push(`< ${c.lt}`);
    if (c.lte !== undefined) parts.push(`≤ ${c.lte}`);
    return `${l} ${parts.filter(Boolean).join(" ")}`.trim();
  }
  return "";
}

// ---------------------------------------------------------------- helpers

const FLOW_RANK: Record<Flow, number> = { pruned: 0, unknown: 1, ok: 2 };
const minFlow = (a: Flow, b: Flow): Flow => (FLOW_RANK[a] <= FLOW_RANK[b] ? a : b);
const maxFlow = (a: Flow, b: Flow): Flow => (FLOW_RANK[a] >= FLOW_RANK[b] ? a : b);
const edgeKeys = (e: PEdge) => e.branches ?? (e.branch ? [e.branch] : []);
const nodeKeys = (n: PNode) => n.branch_in ?? (n.branch ? [n.branch] : []);
const isGate = (n: PNode) => n.type === "mdt" || n.type === "end";
const BLOCKING: VState[] = ["missing_needed", "in_progress", "conflict", "undecided"];
const FINISHED: VState[] = ["done", "waived", "skipped", "decided", "missing_optional", "gate_ready"];

export function topoOrder(p: Pathway): { order: string[]; cycle: boolean } {
  const indeg: Record<string, number> = {};
  const succ: Record<string, string[]> = {};
  for (const n of p.graph.nodes) {
    indeg[n.id] = 0;
    succ[n.id] = [];
  }
  for (const e of p.graph.edges) {
    if (!(e.source in succ) || !(e.target in indeg)) continue;
    indeg[e.target]++;
    succ[e.source].push(e.target);
  }
  const q = p.graph.nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
  const order: string[] = [];
  while (q.length) {
    const x = q.shift()!;
    order.push(x);
    for (const y of succ[x]) if (--indeg[y] === 0) q.push(y);
  }
  const cycle = order.length !== p.graph.nodes.length;
  if (cycle) for (const n of p.graph.nodes) if (!order.includes(n.id)) order.push(n.id);
  return { order, cycle };
}

export function validate(p: Pathway): string[] {
  const w: string[] = [];
  const ids = new Set<string>();
  for (const n of p.graph.nodes) {
    if (ids.has(n.id)) w.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
  }
  const owners = new Map<string, string>();
  for (const n of p.graph.nodes)
    for (const b of n.branches ?? []) {
      if (owners.has(b.key) && n.type === "decision") w.push(`branch key "${b.key}" used by ${owners.get(b.key)} and ${n.id}`);
      owners.set(b.key, n.id);
    }
  for (const e of p.graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) w.push(`edge ${e.source} → ${e.target} points to an unknown node`);
    for (const k of edgeKeys(e)) if (!owners.has(k)) w.push(`edge ${e.source} → ${e.target}: unknown branch "${k}"`);
  }
  for (const n of p.graph.nodes) {
    for (const k of nodeKeys(n)) if (!owners.has(k)) w.push(`${n.id}: unknown branch "${k}"`);
    for (const s of [...(n.sources ?? []), ...(n.waiver?.sources ?? [])]) {
      if (p.sources && !(s.ref in p.sources)) w.push(`${n.id}: unknown source "${s.ref}"`);
      if (s.role === "binding" && !s.quote && !s.note) w.push(`${n.id}: binding source without quote`);
    }
    if (n.type === "decision" && (n.branches?.length ?? 0) < 2) w.push(`decision ${n.id} needs at least two branches`);
  }
  if (topoOrder(p).cycle) w.push("the pathway contains a cycle");
  return w;
}

// ---------------------------------------------------------------- evaluation

export function evaluate(p: Pathway, s: CaseState): Evaluation {
  const warnings = validate(p);
  const nodes = p.graph.nodes;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const incoming: Record<string, PEdge[]> = Object.fromEntries(nodes.map((n) => [n.id, []]));
  const outgoing: Record<string, PEdge[]> = Object.fromEntries(nodes.map((n) => [n.id, []]));
  for (const e of p.graph.edges) {
    if (!byId[e.source] || !byId[e.target]) continue;
    incoming[e.target].push(e);
    outgoing[e.source].push(e);
  }
  const { order } = topoOrder(p);
  const decisions = nodes.filter((n) => n.type === "decision");
  const owner = new Map<string, string>();
  for (const d of decisions) for (const b of d.branches ?? []) owner.set(b.key, d.id);

  // decision → enum fact whose values cover its branch keys (e.g. resectability, bclc_stage)
  const decisionFact: Record<string, string> = {};
  for (const d of decisions) {
    const keys = (d.branches ?? []).map((b) => b.key);
    const f = (d.produces ?? []).find((id) => {
      const def = p.facts?.[id];
      return def?.type === "enum" && keys.every((k) => def.values?.includes(k));
    });
    if (f) decisionFact[d.id] = f;
  }

  // facts and decisions depend on each other (rule decisions read facts, decisions set facts) → iterate to a fixpoint
  const facts: Record<string, FactValue> = {};
  const factOrigin: Evaluation["factOrigin"] = {};
  for (const [k, v] of Object.entries(s.facts)) {
    if (Object.values(decisionFact).includes(k)) continue; // owned by its decision
    facts[k] = v;
    factOrigin[k] = "user";
  }
  const chosen: Record<string, { chosen: string[] | null; auto: boolean }> = {};
  const decide = (d: PNode) => {
    const manual = s.decisions[d.id];
    if (manual?.length) return { chosen: manual, auto: false };
    if (d.decided_by !== "rule") return { chosen: null, auto: false };
    for (const b of d.branches ?? []) {
      if (b.when?.else) return { chosen: [b.key], auto: true };
      const r = evalCond(b.when, facts);
      if (r === true) return { chosen: [b.key], auto: true };
      if (r === null) return { chosen: null, auto: true };
    }
    return { chosen: null, auto: true };
  };
  for (let pass = 0; pass < 4; pass++) {
    for (const [k, def] of Object.entries(p.facts ?? {})) {
      if (!def.derived || factOrigin[k] === "user") continue;
      const v = evalCond(def.derived, facts);
      if (v === null) delete facts[k];
      else {
        facts[k] = v;
        factOrigin[k] = "derived";
      }
    }
    for (const d of decisions) {
      chosen[d.id] = decide(d);
      const f = decisionFact[d.id];
      if (!f) continue;
      const c = chosen[d.id].chosen;
      if (c?.length === 1) {
        facts[f] = c[0];
        factOrigin[f] = "decision";
      } else delete facts[f];
    }
  }

  const gate = (keys: string[]): Flow => {
    let f: Flow = "ok";
    const byOwner = new Map<string, string[]>();
    for (const k of keys) {
      const o = owner.get(k);
      if (o) byOwner.set(o, [...(byOwner.get(o) ?? []), k]);
    }
    for (const [o, ks] of byOwner) {
      const c = chosen[o]?.chosen;
      f = minFlow(f, c == null ? "unknown" : c.some((x) => ks.includes(x)) ? "ok" : "pruned");
    }
    return f;
  };

  const ev: Record<string, NodeEval> = {};
  const edgeFlow = new Map<PEdge, Flow>();
  for (const id of order) {
    const n = byId[id];
    // 1) flow
    let flow: Flow = incoming[id].length ? "pruned" : "ok";
    for (const e of incoming[id]) {
      const f = minFlow(ev[e.source]?.flow ?? "unknown", gate(edgeKeys(e)));
      edgeFlow.set(e, f);
      flow = maxFlow(flow, f);
    }
    flow = minFlow(flow, gate(nodeKeys(n)));
    // 2) condition, 3) level
    const cond = evalCond(n.condition, facts);
    let level: Level | null;
    if (n.level_rules?.length) {
      level = null;
      let unknown = false;
      for (const r of n.level_rules) {
        const v = evalCond(r.when, facts);
        if (v === true) {
          level = r.level;
          break;
        }
        if (v === null) unknown = true;
      }
      // no rule matched: the node's own level is the default – also while a rule's fact is still unknown, so a
      // conservative default ("required" until resectability is known) keeps the step red instead of "?"
      const fallback = n.level && n.level !== "conditional" ? n.level : null;
      if (level === null) level = fallback ?? (unknown ? null : "optional");
    } else level = n.level ?? "required";
    if (level === "conditional") level = "required";
    let downgraded = false;
    if (level === "required" && n.sources?.length && n.sources.every((x) => x.role === "structure")) {
      level = "recommended";
      downgraded = true;
    }
    const waived = !!n.waiver && evalCond(n.waiver.when, facts) === true;
    const c = chosen[id] ?? { chosen: null, auto: false };
    const manual = s.nodes[id];

    // 4) visual state
    let vstate: VState;
    if (flow === "pruned") vstate = "pruned";
    else if (n.type === "decision") vstate = c.chosen?.length ? "decided" : flow === "unknown" ? "undetermined" : "undecided";
    else if (manual === "done" || manual === "in_progress" || manual === "conflict") vstate = manual;
    else if (cond === false) vstate = "skipped";
    else if (waived) vstate = "waived";
    else if (n.completion === "auto") {
      const srcs = incoming[id].filter((e) => edgeFlow.get(e) !== "pruned").map((e) => ev[e.source].vstate);
      vstate = srcs.length && srcs.every((x) => FINISHED.includes(x)) ? "done" : "pending";
    } else if (flow === "unknown" || cond === null || level === null) vstate = "undetermined";
    else if (level === "required" && n.blocking !== false) vstate = "missing_needed";
    else vstate = "missing_optional";

    ev[id] = { id, flow, cond, level: level as EffLevel | null, downgraded, waived, vstate, chosen: c.chosen, autoChosen: c.auto, gates: [], blockers: [] };
  }

  // gates each step leads to (forward reachability over live edges)
  const live = (e: PEdge) => edgeFlow.get(e) !== "pruned" && ev[e.target].vstate !== "pruned";
  for (const n of nodes) {
    const seen = new Set<string>();
    const stack = outgoing[n.id].filter(live).map((e) => e.target);
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      if (isGate(byId[x])) ev[n.id].gates.push(x);
      stack.push(...outgoing[x].filter(live).map((e) => e.target));
    }
  }
  // gate readiness (an MDT that is required but not held yet)
  for (const n of nodes) {
    const e = ev[n.id];
    if (n.type !== "mdt" || e.vstate !== "missing_needed") continue;
    e.blockers = nodes.filter((x) => ev[x.id].gates.includes(n.id) && BLOCKING.includes(ev[x.id].vstate)).map((x) => x.id);
    e.vstate = e.blockers.length ? "gate_waiting" : "gate_ready";
  }
  // an end node is reached only when nothing live before it is still open (not just its direct predecessors)
  for (const n of nodes) {
    const e = ev[n.id];
    if (n.type !== "end" || n.completion !== "auto" || e.vstate !== "done") continue;
    const open = nodes.some((x) => ev[x.id].gates.includes(n.id) && [...BLOCKING, "gate_ready", "gate_waiting", "pending"].includes(ev[x.id].vstate));
    if (open) e.vstate = "pending";
  }

  const edges = p.graph.edges
    .filter((e) => byId[e.source] && byId[e.target])
    .map((edge) => {
      const flow = ev[edge.target].vstate === "pruned" || ev[edge.source].vstate === "pruned" ? "pruned" : (edgeFlow.get(edge) ?? "ok");
      const t = ev[edge.target].vstate;
      const sv = ev[edge.source].vstate;
      let style: EdgeStyle;
      if (flow === "pruned") style = "pruned";
      else if (t === "in_progress") style = "active";
      else if (t === "missing_needed") style = "needed";
      else if (t === "conflict") style = "conflict";
      else if (t === "undetermined" || t === "undecided" || flow === "unknown") style = "open";
      else if (FINISHED.includes(sv) && ["done", "decided", "waived", "gate_ready"].includes(t)) style = "done";
      else if (t === "skipped" || t === "missing_optional") style = "optional";
      else style = "pending";
      return { edge, flow, style };
    });

  const red = order.filter((id) => ev[id].vstate === "missing_needed" && byId[id].type !== "mdt");
  return { facts, factOrigin, decisionFact, nodes: ev, edges, red, warnings };
}

/** Next manual status on double-click. */
export const cycleStatus = (s: string | undefined) =>
  (({ missing: "in_progress", in_progress: "done", done: "conflict", conflict: "missing" }) as Record<string, string>)[s ?? "missing"] ?? "in_progress";
