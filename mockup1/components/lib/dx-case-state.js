// Maps a mockup case onto the diagnostic pathway engine's CaseState. Pure (no DOM), rule-based, no AI.
const TASK_STATUS = { done: 'done', running: 'in_progress' };
const RANK = { missing: 0, in_progress: 1, conflict: 2, done: 3 };

/** Case (tasks, values, handover, MDT) → engine CaseState, via the per-case map (data/dx-map-<case>.json). */
export function caseState(c, map) {
  const nodes = {};
  const put = (id, s) => { if ((RANK[s] ?? 0) >= (RANK[nodes[id]] ?? 0)) nodes[id] = s; };
  const from = {};
  if (c.phase !== 'draft') put('referral', 'done');
  for (const t of c.tasks || []) {
    for (const id of map.tasks?.[t.id] || []) {
      put(id, TASK_STATUS[t.status] || 'missing');
      from[id] = t.title;
    }
  }
  const text = (c.handover?.sections || []).map((s) => s.text).join('\n');
  for (const [id, pattern] of Object.entries(map.handover || {})) {
    if (c.handover && new RegExp(pattern, 'i').test(text)) { put(id, 'done'); from[id] ||= 'handover od lékaře'; }
  }
  const facts = { ...(map.facts || {}) };
  for (const [k, m] of Object.entries(map.values || {})) {
    const v = c.values?.[k];
    if (!v) continue;
    put(m.node, 'done');
    from[m.node] = `hodnota ${k.toUpperCase()} = ${v.value}`;
    if (m.fact) facts[m.fact] = v.value;
  }
  for (const [id, f] of Object.entries(c.docFindings || {})) {
    put(id, 'done');
    from[id] ||= `${f.value || 'doloženo'} · dokument ${f.file} (AI ${f.modelLabel || f.model}, potvrdil(a) ${f.confirmedBy})`;
    for (const [k, v] of Object.entries(f.facts || {})) if (!(k in facts) || k === 'ecog') facts[k] = v;
  }
  const mdt = c.mdt || [];
  if (map.mdtNode && mdt.length) { put(map.mdtNode, 'done'); from[map.mdtNode] = mdt.map((m) => `${m.title} ${m.date}`).join(', '); }
  if (map.mdtIssue && mdt.some((m) => m.issue) && !mdt.some((m) => m.decision)) {
    for (const id of map.mdtIssue.nodes) { nodes[id] = 'conflict'; from[id] = mdt.find((m) => m.issue).conclusion; }
    Object.assign(facts, map.mdtIssue.facts);
  }
  const decisions = {};
  for (const [id, d] of Object.entries(map.decisions || {})) {
    const text = String(c[d.from] || '').toLowerCase();
    const hit = text && d.match.find(([needle]) => text.includes(needle));
    if (hit) { decisions[id] = [hit[1]]; from[id] = c[d.from]; }
  }
  return { state: { nodes, decisions, facts }, from };
}
