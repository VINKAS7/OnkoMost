import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** GET `url`, re-fetch on `reload()`, on the global "onkomost:refresh" event, and every `pollMs` if given. */
export function useFetch<T>(url: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api.get<T>(url).then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [url, tick]);
  useEffect(() => {
    const h = () => reload();
    window.addEventListener("onkomost:refresh", h);
    const t = pollMs ? setInterval(reload, pollMs) : undefined;
    return () => { window.removeEventListener("onkomost:refresh", h); if (t) clearInterval(t); };
  }, [reload, pollMs]);
  return { data, error, reload, setData };
}
