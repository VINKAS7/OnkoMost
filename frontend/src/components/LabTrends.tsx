import { useState } from "react";
import { fmtDate } from "../api";
import { useApp } from "../ctx";
import { dayNum, useWidth } from "../facts";
import { useFetch } from "../hooks";
import type { GraphView } from "../types";
import { Tag } from "./ui";

/**
 * Lab values from the patient graph, up to the cut-off: tumour markers as figures, analytes measured more than once as
 * small multiples on one shared time axis (so dates line up across charts), each with its reference range as a band.
 */
type Pt = { day: number; date: string; value: number; text: string; flag: string | null };
type Series = { key: string; analyte: string; unit: string; ref: string; lo: number | null; hi: number | null; pts: Pt[]; marker: boolean };

const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/** "0,58–1,75" → [0.58, 1.75]; "< 35" → [null, 35]; "> 60" → [60, null] */
function parseRef(ref: string): [number | null, number | null] {
  const r = ref.trim();
  let m = r.match(/^([\d.,]+)\s*[–-]\s*([\d.,]+)/);
  if (m) return [num(m[1]), num(m[2])];
  m = r.match(/^[<≤]\s*([\d.,]+)/);
  if (m) return [null, num(m[1])];
  m = r.match(/^[>≥]\s*([\d.,]+)/);
  if (m) return [num(m[1]), null];
  return [null, null];
}

function collect(view: GraphView): Series[] {
  const by: Record<string, Series> = {};
  for (const n of view.nodes) {
    if (n.kind !== "lab") continue;
    const p = n.props as Record<string, unknown>;
    const v = typeof p.value_num === "number" ? p.value_num : null;
    if (v == null || !p.date || !p.analyte) continue;
    const key = `${p.analyte}|${p.unit ?? ""}`;
    const s = (by[key] ??= { key, analyte: String(p.analyte), unit: String(p.unit ?? ""), ref: String(p.ref ?? ""), lo: null, hi: null, pts: [], marker: !!p.is_tumor_marker });
    if (!s.ref && p.ref) s.ref = String(p.ref);
    const date = String(p.date);
    if (!s.pts.some((x) => x.date === date && x.value === v)) s.pts.push({ day: dayNum(date), date, value: v, text: String(p.value ?? v), flag: (p.flag as string) || null });
  }
  return Object.values(by).map((s) => {
    [s.lo, s.hi] = parseRef(s.ref);
    s.pts.sort((a, b) => a.day - b.day);
    return s;
  });
}

function FlagTag({ flag }: { flag: string | null }) {
  const { t } = useApp();
  if (!flag) return null;
  const high = /H|\+/.test(flag);
  return <Tag color={high ? "red" : "blue"}>{high ? `↑ ${t("lab.high")}` : `↓ ${t("lab.low")}`}</Tag>;
}

const CH = 92, PX = 14, PY = 14;

function Mini({ s, width, lo, hi }: { s: Series; width: number; lo: number; hi: number }) {
  const { t } = useApp();
  const [hover, setHover] = useState<Pt | null>(null);
  const vals = s.pts.map((p) => p.value);
  let y0 = Math.min(...vals, s.lo ?? Infinity), y1 = Math.max(...vals, s.hi ?? -Infinity);
  if (s.lo == null && s.hi != null) y0 = Math.min(y0, 0);
  const padY = (y1 - y0 || Math.abs(y1) || 1) * 0.18;
  y0 -= padY; y1 += padY;
  const X = (d: number) => PX + ((d - lo) / Math.max(hi - lo, 1)) * (width - 2 * PX);
  const Y = (v: number) => PY + (1 - (v - y0) / (y1 - y0)) * (CH - 2 * PY);
  const last = s.pts[s.pts.length - 1], first = s.pts[0];
  const bandTop = s.hi != null ? Y(Math.min(s.hi, y1)) : PY, bandBot = s.lo != null ? Y(Math.max(s.lo, y0)) : CH - PY;
  return (
    <div className="lab-card">
      <div className="spread" style={{ alignItems: "baseline", gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>{s.analyte}</span>
        <span className="small"><b>{last.text}</b> <span className="muted xs">{s.unit}</span></span>
      </div>
      <div className="spread xs muted" style={{ minHeight: 22 }}>
        <span>{s.ref ? `${t("lab.ref")} ${s.ref}` : ""}</span>
        <FlagTag flag={last.flag} />
      </div>
      <div style={{ position: "relative" }}>
        <svg width={width} height={CH} role="img" aria-label={`${s.analyte}: ${s.pts.map((p) => `${fmtDate(p.date)} ${p.text}`).join(", ")}`} style={{ display: "block", overflow: "visible" }}>
          {(s.lo != null || s.hi != null) && <rect x={PX} width={width - 2 * PX} y={bandTop} height={Math.max(bandBot - bandTop, 1)} className="lab-band" rx={3} />}
          {(s.lo != null || s.hi != null) && bandBot - bandTop >= 12 && <text x={width / 2} y={(bandTop + bandBot) / 2} dy="0.35em" textAnchor="middle" className="lab-band-label">{t("lab.range")}</text>}
          <polyline points={s.pts.map((p) => `${X(p.day)},${Y(p.value)}`).join(" ")} className="lab-line" />
          {s.pts.map((p) => (
            <g key={p.date} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
              <circle cx={X(p.day)} cy={Y(p.value)} r={11} fill="transparent" />
              <circle cx={X(p.day)} cy={Y(p.value)} r={4} className={`lab-dot ${p.flag ? "out" : ""}`} />
            </g>
          ))}
          {s.pts.length > 1 && <text x={X(first.day)} y={Y(first.value) - 9} textAnchor="start" className="lab-val">{first.text}</text>}
          <text x={X(last.day)} y={Y(last.value) - 9} textAnchor="end" className="lab-val">{last.text}</text>
        </svg>
        {hover && (
          <div className="viz-tip" style={{ left: Math.min(Math.max(X(hover.day) - 70, 0), width - 150), top: Y(hover.value) + 12 }}>
            <div style={{ fontWeight: 600 }}>{hover.text} {s.unit}</div>
            <div className="muted">{fmtDate(hover.date)}{hover.flag ? ` · ${/H|\+/.test(hover.flag) ? t("lab.high") : t("lab.low")}` : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function LabTrends({ caseId, cutoff }: { caseId: number; cutoff: string | null }) {
  const { t } = useApp();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [all, setAll] = useState(false);
  const { data } = useFetch<GraphView>(`/api/cases/${caseId}/graph${cutoff ? `?cutoff=${cutoff}` : ""}`);
  const series = data ? collect(data) : [];
  const markers = series.filter((s) => s.marker);
  const trends = series.filter((s) => !s.marker && s.pts.length > 1)
    .sort((a, b) => Number(!!b.pts[b.pts.length - 1].flag) - Number(!!a.pts[a.pts.length - 1].flag) || b.pts.length - a.pts.length || a.analyte.localeCompare(b.analyte));
  const days = trends.flatMap((s) => s.pts.map((p) => p.day));
  const lo = Math.min(...days), hi = Math.max(...days);
  const cols = Math.max(1, Math.floor((width + 12) / 232));
  const cardW = cols ? (width - (cols - 1) * 12) / cols - 26 : 0;
  const shown = all ? trends : trends.slice(0, cols * 2);
  return (
    <section ref={ref}>
      <div className="section-title">{t("lab.title")}</div>
      <div className="xs muted" style={{ marginBottom: 10 }}>{t("lab.sub")}</div>
      {markers.length > 0 && (
        <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
          {markers.map((s) => {
            const p = s.pts[s.pts.length - 1];
            return (
              <div key={s.key} className="lab-stat">
                <div className="xs muted">{t("lab.markers")} · {fmtDate(p.date)}</div>
                <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600 }}>{s.analyte}</span>
                  <span className="lab-big">{p.text}</span><span className="xs muted">{s.unit}</span>
                </div>
                <div className="row xs muted" style={{ gap: 8 }}>{s.ref && <span>{t("lab.ref")} {s.ref}</span>}<FlagTag flag={p.flag} /></div>
              </div>
            );
          })}
        </div>
      )}
      {!trends.length && data && <div className="small muted">{t("lab.none")}</div>}
      {width > 0 && trends.length > 0 && (
        <div className="lab-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((s) => <Mini key={s.key} s={s} width={cardW} lo={lo} hi={hi} />)}
        </div>
      )}
      {trends.length > shown.length || all ? (
        <button className="linkbtn" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>{all ? t("lab.less") : `${t("lab.all")} (${trends.length})`}</button>
      ) : null}
    </section>
  );
}
