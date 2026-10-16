// Layered top-down layout for <onco-dx-pathway>: rank = longest path from the start, order within a rank by
// barycentre sweeps. Small and dependency-free (no dagre) so the folder stays copyable.

export const NODE_W = 158;
export const NODE_H = 48;
const GX = 14;
const GY = 30;
const PAD = 8;

export function layout(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const pred = Object.fromEntries(ids.map((i) => [i, []]));
  const succ = Object.fromEntries(ids.map((i) => [i, []]));
  for (const e of edges) if (pred[e.target] && succ[e.source]) { pred[e.target].push(e.source); succ[e.source].push(e.target); }
  const indeg = Object.fromEntries(ids.map((i) => [i, pred[i].length]));
  const q = ids.filter((i) => !indeg[i]);
  const order = [];
  while (q.length) {
    const x = q.shift();
    order.push(x);
    for (const y of succ[x]) if (--indeg[y] === 0) q.push(y);
  }
  for (const i of ids) if (!order.includes(i)) order.push(i); // cycle: keep the rest in file order
  const rank = {};
  for (const i of order) rank[i] = Math.max(0, ...pred[i].map((p) => (rank[p] ?? -1) + 1));
  const layers = [];
  for (const i of order) (layers[rank[i]] ||= []).push(i);
  const centred = () => Object.fromEntries(layers.flatMap((l) => l.map((id, k) => [id, k - (l.length - 1) / 2])));
  for (let it = 0; it < 4; it++) {
    for (const [dir, list] of [['down', pred], ['up', succ]]) {
      const pos = centred();
      const seq = dir === 'down' ? layers.slice(1) : layers.slice(0, -1).reverse();
      for (const l of seq) {
        const bc = (id) => (list[id].length ? list[id].reduce((s, o) => s + pos[o], 0) / list[id].length : pos[id]);
        l.sort((a, b) => bc(a) - bc(b));
      }
    }
  }
  const pos = centred();
  const width = Math.max(1, ...layers.map((l) => l.length)) * (NODE_W + GX) - GX + 2 * PAD;
  const at = {};
  for (const id of ids) at[id] = { x: width / 2 + pos[id] * (NODE_W + GX) - NODE_W / 2, y: PAD + rank[id] * (NODE_H + GY) };
  return { at, width, height: PAD * 2 + layers.length * (NODE_H + GY) - GY };
}

/** Wrap a label into at most two lines of ~n characters. */
export function wrap(s, n = 25) {
  const lines = [''];
  for (const w of String(s).split(' ')) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length <= n) lines[lines.length - 1] = (cur + ' ' + w).trim();
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = lines[1].slice(0, n - 1) + '…'; break; }
  }
  return lines.map((l) => (l.length > n ? l.slice(0, n - 1) + '…' : l));
}
