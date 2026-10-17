import { useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { fmtDate } from "../api";
import { useApp } from "../ctx";
import type { Source, Task } from "../types";

export const STATE_COLOR: Record<string, string> = {
  sent: "gray", in_triage: "blue", waiting_for_documents: "orange", complete: "purple", ready_for_mdt: "purple",
  mdt_conclusion: "blue", feedback_sent: "green", closed: "green",
};
export const DOC_COLOR: Record<string, string> = { have: "green", missing: "red", conflict: "yellow", conditional: "gray", skipped: "gray" };

export function Tag({ color = "gray", children, title }: { color?: string; children: ReactNode; title?: string }) {
  return <span className={`tag ${color}`} title={title}>{children}</span>;
}

/** A coloured dot + short text – the main way status is shown. */
export function Status({ color, children, title, pill }: { color: string; children: ReactNode; title?: string; pill?: boolean }) {
  return <span className={`st ${pill ? "pill-st" : ""}`} title={title}><span className={`dot ${color}`} />{children}</span>;
}

export function StateTag({ state }: { state: string }) {
  const { t } = useApp();
  return <Tag color={STATE_COLOR[state] ?? "gray"}>{t(`st.${state}`)}</Tag>;
}

export function Due({ task }: { task: Pick<Task, "due_on" | "overdue" | "status" | "scheduled_on"> }) {
  const { t } = useApp();
  if (task.status === "scheduled" && task.scheduled_on) return <span>{t("booked")} {fmtDate(task.scheduled_on)}</span>;
  if (!task.due_on) return null;
  return <span style={task.overdue ? { color: "var(--red)" } : undefined}>{task.overdue ? t("overdue") : t("due")} {fmtDate(task.due_on)}</span>;
}

export function Progress({ states, index }: { states: { key: string; label: string; label_en: string }[]; index: number }) {
  const { pick } = useApp();
  return (
    <div className="progress" role="list" aria-label="Case state">
      {states.map((s, i) => (
        <div key={s.key} role="listitem" className={`p ${i < index ? "past" : i === index ? "now" : ""}`}>{pick(s.label, s.label_en)}</div>
      ))}
    </div>
  );
}

export function SourceChips({ sources }: { sources: Source[] }) {
  const { lang } = useApp();
  return (
    <span>
      {sources.map((s, i) => {
        const how = s.method === "llm" ? (lang === "en" ? "read by the LLM" : "vytěženo LLM") : (lang === "en" ? "read by rule" : "vytěženo pravidlem");
        const ok = s.match ? `${lang === "en" ? "quote" : "citace"} ${s.match}` : (lang === "en" ? "quote not found in source" : "citace ve zdroji nenalezena");
        const tip = `${s.title ?? ""} (${fmtDate(s.date)})\n„${s.quote}“\n${how} · ${ok}`;
        const cls = !s.match ? "bad" : s.method === "llm" ? "ai" : "";
        const short = (s.title ?? "").replace(/^(Výsledek vyšetření|Výsledky laboratorního vyšetření|Ambulantní zpráva)\s*[–-]?\s*/, "").slice(0, 30) || (s.title ?? "").slice(0, 30);
        const body = <>{short || "zdroj"}{s.date ? ` · ${fmtDate(s.date)}` : ""}{s.method === "llm" ? " · AI" : ""}</>;
        return s.doc_id ? <a key={i} className={`chip ${cls}`} title={tip} href={`/api/documents/${s.doc_id}/raw`}>{body}</a>
          : <span key={i} className={`chip ${cls}`} title={tip}>{body}</span>;
      })}
    </span>
  );
}

export function Callout({ color = "", children }: { color?: string; children: ReactNode }) {
  return <div className={`callout ${color}`}><div className="grow">{children}</div></div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted small" style={{ padding: "8px 0" }}>{children}</div>;
}

export function PageHead({ title, lead, right }: { title: ReactNode; lead?: ReactNode; right?: ReactNode }) {
  return (
    <div className="spread wrap" style={{ alignItems: "flex-end" }}>
      <div>
        <h1>{title}</h1>
        {lead && <div className="lead">{lead}</div>}
      </div>
      {right}
    </div>
  );
}

export function LangSwitch() {
  const { lang, setLang } = useApp();
  return (
    <div className="seg" role="group" aria-label="Language">
      <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
      <button className={lang === "cs" ? "on" : ""} onClick={() => setLang("cs")}>CS</button>
    </div>
  );
}

export function ThemeSwitch() {
  const { theme, setTheme, lang } = useApp();
  const label = (th: "light" | "dark") => (lang === "cs" ? { light: "Světlý", dark: "Tmavý" } : { light: "Light", dark: "Dark" })[th];
  return (
    <div className="seg" role="group" aria-label={lang === "cs" ? "Motiv" : "Theme"}>
      <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>{label("light")}</button>
      <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>{label("dark")}</button>
    </div>
  );
}

/** A textarea that grows with its text instead of scrolling. */
export function AutoTextarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit, [props.value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return <textarea ref={ref} rows={1} className={`auto ${className}`} {...props} />;
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

/** "7 have · 2 missing · 1 conflict" as coloured dots. */
export function DocCounts({ counts }: { counts: { have?: number; missing?: number; conflict?: number } }) {
  const { t } = useApp();
  return (
    <span className="row" style={{ gap: 12 }}>
      <Status color="green">{counts.have ?? 0} {t("doc.have").toLowerCase()}</Status>
      {!!counts.missing && <Status color="red">{counts.missing} {t("doc.missing").toLowerCase()}</Status>}
      {!!counts.conflict && <Status color="yellow">{counts.conflict} {t("doc.conflict").toLowerCase()}</Status>}
    </span>
  );
}
