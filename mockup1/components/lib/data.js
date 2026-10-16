// Cached loaders for static files (/data JSON, /assets SVG).
const cache = new Map();

function load(url, as) {
  const key = `${as}:${url}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r[as]();
    }).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

export const loadJSON = (url) => load(url, 'json');
export const loadText = (url) => load(url, 'text');
