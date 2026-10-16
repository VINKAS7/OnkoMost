// GENERATED from pathway-viewer/src/engine.ts by `npm run export:mockup` – do not edit here.
function evalCond(c, facts) {
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
    if (v === void 0) return null;
    const checks = [];
    if ("eq" in c) checks.push(v === c.eq);
    if (c.in) checks.push(c.in.includes(v));
    const n = typeof v === "number" ? v : Number.NaN;
    if (c.gt !== void 0) checks.push(n > c.gt);
    if (c.gte !== void 0) checks.push(n >= c.gte);
    if (c.lt !== void 0) checks.push(n < c.lt);
    if (c.lte !== void 0) checks.push(n <= c.lte);
    return checks.length ? checks.every(Boolean) : Boolean(v);
  }
  return true;
}
function condText(c, label, words = { and: "AND", or: "OR", not: "NOT", else: "otherwise" }) {
  if (!c) return "";
  const sub = (x) => {
    const t = condText(x, label, words);
    return x.all || x.any ? `(${t})` : t;
  };
  if (c.else) return words.else;
  if (c.all) return c.all.map(sub).join(` ${words.and} `);
  if (c.any) return c.any.map(sub).join(` ${words.or} `);
  if (c.not) return `${words.not} ${sub(c.not)}`;
  if (c.fact) {
    const l = label(c.fact);
    const parts = [];
    if ("eq" in c) parts.push(c.eq === true ? "" : c.eq === false ? "= ne/no" : `= ${String(c.eq)}`);
    if (c.in) parts.push(`\u2208 {${c.in.join(", ")}}`);
    if (c.gt !== void 0) parts.push(`> ${c.gt}`);
    if (c.gte !== void 0) parts.push(`\u2265 ${c.gte}`);
    if (c.lt !== void 0) parts.push(`< ${c.lt}`);
    if (c.lte !== void 0) parts.push(`\u2264 ${c.lte}`);
    return `${l} ${parts.filter(Boolean).join(" ")}`.trim();
  }
  return "";
}
const FLOW_RANK = { pruned: 0, unknown: 1, ok: 2 };
const minFlow = (a, b) => FLOW_RANK[a] <= FLOW_RANK[b] ? a : b;
const maxFlow = (a, b) => FLOW_RANK[a] >= FLOW_RANK[b] ? a : b;
const edgeKeys = (e) => e.branches ?? (e.branch ? [e.branch] : []);
const nodeKeys = (n) => n.branch_in ?? (n.branch ? [n.branch] : []);
const isGate = (n) => n.type === "mdt" || n.type === "end";
const BLOCKING = ["missing_needed", "in_progress", "conflict", "undecided"];
const FINISHED = ["done", "waived", "skipped", "decided", "missing_optional", "gate_ready"];
function topoOrder(p) {
  const indeg = {};
  const succ = {};
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
  const order = [];
  while (q.length) {
    const x = q.shift();
    order.push(x);
    for (const y of succ[x]) if (--indeg[y] === 0) q.push(y);
  }
  const cycle = order.length !== p.graph.nodes.length;
  if (cycle) {
    for (const n of p.graph.nodes) if (!order.includes(n.id)) order.push(n.id);
  }
  return { order, cycle };
}
function validate(p) {
  const w = [];
  const ids = /* @__PURE__ */ new Set();
  for (const n of p.graph.nodes) {
    if (ids.has(n.id)) w.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
  }
  const owners = /* @__PURE__ */ new Map();
  for (const n of p.graph.nodes)
    for (const b of n.branches ?? []) {
      if (owners.has(b.key) && n.type === "decision") w.push(`branch key "${b.key}" used by ${owners.get(b.key)} and ${n.id}`);
      owners.set(b.key, n.id);
    }
  for (const e of p.graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) w.push(`edge ${e.source} \u2192 ${e.target} points to an unknown node`);
    for (const k of edgeKeys(e)) if (!owners.has(k)) w.push(`edge ${e.source} \u2192 ${e.target}: unknown branch "${k}"`);
  }
  for (const n of p.graph.nodes) {
    for (const k of nodeKeys(n)) if (!owners.has(k)) w.push(`${n.id}: unknown branch "${k}"`);
    for (const s of [...n.sources ?? [], ...n.waiver?.sources ?? []]) {
      if (p.sources && !(s.ref in p.sources)) w.push(`${n.id}: unknown source "${s.ref}"`);
      if (s.role === "binding" && !s.quote && !s.note) w.push(`${n.id}: binding source without quote`);
    }
    if (n.type === "decision" && (n.branches?.length ?? 0) < 2) w.push(`decision ${n.id} needs at least two branches`);
  }
  if (topoOrder(p).cycle) w.push("the pathway contains a cycle");
  return w;
}
function evaluate(p, s) {
  const warnings = validate(p);
  const nodes = p.graph.nodes;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const incoming = Object.fromEntries(nodes.map((n) => [n.id, []]));
  const outgoing = Object.fromEntries(nodes.map((n) => [n.id, []]));
  for (const e of p.graph.edges) {
    if (!byId[e.source] || !byId[e.target]) continue;
    incoming[e.target].push(e);
    outgoing[e.source].push(e);
  }
  const { order } = topoOrder(p);
  const decisions = nodes.filter((n) => n.type === "decision");
  const owner = /* @__PURE__ */ new Map();
  for (const d of decisions) for (const b of d.branches ?? []) owner.set(b.key, d.id);
  const decisionFact = {};
  for (const d of decisions) {
    const keys = (d.branches ?? []).map((b) => b.key);
    const f = (d.produces ?? []).find((id) => {
      const def = p.facts?.[id];
      return def?.type === "enum" && keys.every((k) => def.values?.includes(k));
    });
    if (f) decisionFact[d.id] = f;
  }
  const facts = {};
  const factOrigin = {};
  for (const [k, v] of Object.entries(s.facts)) {
    if (Object.values(decisionFact).includes(k)) continue;
    facts[k] = v;
    factOrigin[k] = "user";
  }
  const chosen = {};
  const decide = (d) => {
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
  const gate = (keys) => {
    let f = "ok";
    const byOwner = /* @__PURE__ */ new Map();
    for (const k of keys) {
      const o = owner.get(k);
      if (o) byOwner.set(o, [...byOwner.get(o) ?? [], k]);
    }
    for (const [o, ks] of byOwner) {
      const c = chosen[o]?.chosen;
      f = minFlow(f, c == null ? "unknown" : c.some((x) => ks.includes(x)) ? "ok" : "pruned");
    }
    return f;
  };
  const ev = {};
  const edgeFlow = /* @__PURE__ */ new Map();
  for (const id of order) {
    const n = byId[id];
    let flow = incoming[id].length ? "pruned" : "ok";
    for (const e of incoming[id]) {
      const f = minFlow(ev[e.source]?.flow ?? "unknown", gate(edgeKeys(e)));
      edgeFlow.set(e, f);
      flow = maxFlow(flow, f);
    }
    flow = minFlow(flow, gate(nodeKeys(n)));
    const cond = evalCond(n.condition, facts);
    let level;
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
    let vstate;
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
    ev[id] = { id, flow, cond, level, downgraded, waived, vstate, chosen: c.chosen, autoChosen: c.auto, gates: [], blockers: [] };
  }
  const live = (e) => edgeFlow.get(e) !== "pruned" && ev[e.target].vstate !== "pruned";
  for (const n of nodes) {
    const seen = /* @__PURE__ */ new Set();
    const stack = outgoing[n.id].filter(live).map((e) => e.target);
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      if (isGate(byId[x])) ev[n.id].gates.push(x);
      stack.push(...outgoing[x].filter(live).map((e) => e.target));
    }
  }
  for (const n of nodes) {
    const e = ev[n.id];
    if (n.type !== "mdt" || e.vstate !== "missing_needed") continue;
    e.blockers = nodes.filter((x) => ev[x.id].gates.includes(n.id) && BLOCKING.includes(ev[x.id].vstate)).map((x) => x.id);
    e.vstate = e.blockers.length ? "gate_waiting" : "gate_ready";
  }
  for (const n of nodes) {
    const e = ev[n.id];
    if (n.type !== "end" || n.completion !== "auto" || e.vstate !== "done") continue;
    const open = nodes.some((x) => ev[x.id].gates.includes(n.id) && [...BLOCKING, "gate_ready", "gate_waiting", "pending"].includes(ev[x.id].vstate));
    if (open) e.vstate = "pending";
  }
  const edges = p.graph.edges.filter((e) => byId[e.source] && byId[e.target]).map((edge) => {
    const flow = ev[edge.target].vstate === "pruned" || ev[edge.source].vstate === "pruned" ? "pruned" : edgeFlow.get(edge) ?? "ok";
    const t = ev[edge.target].vstate;
    const sv = ev[edge.source].vstate;
    let style;
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
const cycleStatus = (s) => ({ missing: "in_progress", in_progress: "done", done: "conflict", conflict: "missing" })[s ?? "missing"] ?? "in_progress";
export {
  condText,
  cycleStatus,
  evalCond,
  evaluate,
  topoOrder,
  validate
};
