import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { translate, type Lang } from "./i18n";
import type { Health, Koc } from "./types";

type Ctx = {
  kocs: Koc[];
  kocId: number;
  setKocId: (id: number) => void;
  koc: Koc | undefined;
  health: Health | null;
  refreshHealth: () => void;
  toast: (msg: string, error?: boolean) => void;
  actor: string;
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  t: (key: string) => string;
  /** pick the Czech or English variant of a bilingual value */
  pick: (cs?: string | null, en?: string | null) => string;
};

export type Theme = "light" | "dark";

const AppCtx = createContext<Ctx | null>(null);

function systemTheme(): Theme {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
}

function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage may be blocked */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [kocs, setKocs] = useState<Koc[]>([]);
  const [kocId, setKocIdState] = useState<number>(() => Number(load("onkomost.koc") ?? 2));
  const [lang, setLangState] = useState<Lang>(() => (load("onkomost.lang") as Lang) || "en");
  const [theme, setThemeState] = useState<Theme>(() => (load("onkomost.theme") as Theme) || systemTheme());
  const [health, setHealth] = useState<Health | null>(null);
  const [toastMsg, setToast] = useState<{ msg: string; error?: boolean } | null>(null);

  const refreshHealth = useCallback(() => {
    api.get<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(() => {
    api.get<Koc[]>("/api/kocs").then(setKocs).catch(() => setKocs([]));
    refreshHealth();
    const timer = setInterval(refreshHealth, 15000);
    return () => clearInterval(timer);
  }, [refreshHealth]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const setKocId = (id: number) => { setKocIdState(id); save("onkomost.koc", String(id)); };
  const setLang = (l: Lang) => { setLangState(l); save("onkomost.lang", l); };
  const setTheme = (th: Theme) => { setThemeState(th); save("onkomost.theme", th); };
  const toast = useCallback((msg: string, error?: boolean) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), error ? 6000 : 3000);
  }, []);
  const t = useCallback((key: string) => translate(lang, key), [lang]);
  const pick = useCallback((cs?: string | null, en?: string | null) => (lang === "en" ? en || cs : cs || en) ?? "", [lang]);
  const koc = kocs.find((k) => k.id === kocId);

  return (
    <AppCtx.Provider value={{ kocs, kocId, setKocId, koc, health, refreshHealth, toast, actor: koc?.coordinator_name ?? "koordinátor", lang, setLang, theme, setTheme, t, pick }}>
      {children}
      {toastMsg && <div className={`toast ${toastMsg.error ? "error" : ""}`} role="status">{toastMsg.msg}</div>}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

/** Run an API action, show errors as a toast, then call `after`. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string, after?: (r: T) => void) => {
      setBusy(true);
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        after?.(r);
        return r;
      } catch (e) {
        toast((e as Error).message, true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}
