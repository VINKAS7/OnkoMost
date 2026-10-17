import { useState } from "react";
import { fmtDate } from "../api";
import { useApp } from "../ctx";
import { DOC_CATEGORIES, dayNum, docCategory, useWidth } from "../facts";
import type { CaseDetail, DocumentRow } from "../types";

/**
 * The case on a time axis: one row per kind of document, a dot per document (hollow = after the MDT), milestone rules
 * for referral / MDT / closed, and the diagnostic interval (referral → MDT) as a light wash. Identity is carried by
 * the row labels, so the dots use a single hue.
 */
const GUTTER = 150, ROW = 26, BOTTOM = 26, PAD = 14;

type Point = { doc: DocumentRow; row: number; x: number; after: boolean };

export function JourneyTimeline({ c }: { c: CaseDetail }) {
  const { t, lang } = useApp();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Point | null>(null);
  const docs = c.documents.filter((d) => d.doc_date && d.status !== "blocked");
  const end = c.closed_on ?? c.today;
  const milestones = ([["referral", c.created_on], ["mdt", c.mdt_date], ["closed", c.closed_on]] as [string, string | null][])
    .filter((m): m is [string, string] => !!m[1]);
  const days = [...docs.map((d) => dayNum(d.doc_date!)), ...milestones.map((m) => dayNum(m[1])), dayNum(end)];
  const lo = Math.min(...days) - 3, hi = Math.max(...days) + 3;
  const cats = DOC_CATEGORIES.filter((k) => k === "referral" || docs.some((d) => docCategory(d.doc_type) === k));
  const plotW = Math.max(width - GUTTER - PAD, 10);
  const x = (iso: string) => GUTTER + ((dayNum(iso) - lo) / (hi - lo)) * plotW;
  const mdtDay = c.mdt_date ? dayNum(c.mdt_date) : null;

  // dots; same day + same row are nudged apart so both stay visible
  const seen: Record<string, number> = {};
  const points: Point[] = docs.map((d) => {
    const row = cats.indexOf(docCategory(d.doc_type));
    const key = `${row}:${d.doc_date}`;
    const n = (seen[key] = (seen[key] ?? -1) + 1);
    return { doc: d, row, x: x(d.doc_date!) + n * 9, after: mdtDay != null && dayNum(d.doc_date!) > mdtDay };
  });

  // month ticks
  const ticks: { x: number; label: string }[] = [];
  const fmtMonth = new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", { month: "short" });
  for (let d = new Date(Date.UTC(1970, 0, 1 + lo)); d.getTime() / 86400000 <= hi; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const day = first.getTime() / 86400000;
    if (day >= lo) ticks.push({ x: GUTTER + ((day - lo) / (hi - lo)) * plotW, label: fmtMonth.format(first) });
  }

  // milestone labels: a second line when two would collide
  // labels start right of their rule (near the right edge they end at it), each on the first line where it overlaps
  // no label already placed
  const placed: [number, number][][] = [];
  const marks = milestones.map(([k, iso]) => {
    const mx = x(iso);
    const textW = (t(`tl.m.${k}`).length + 9) * 6.8;
    const anchor = mx + 5 + textW > width - PAD ? "end" : "start";
    const span: [number, number] = anchor === "start" ? [mx, mx + 5 + textW] : [mx - 5 - textW, mx];
    let line = 0;
    while ((placed[line] ?? []).some(([a, b]) => span[0] < b + 8 && a < span[1] + 8)) line++;
    (placed[line] ??= []).push(span);
    return { k, iso, x: mx, y: 12 + line * 15, anchor };
  });
  const TOP = 24 + Math.max(placed.length, 1) * 15;
  const h = TOP + cats.length * ROW + BOTTOM;

  const span = (a: string | null, b: string | null) => (a && b ? dayNum(b) - dayNum(a) : null);
  const toMdt = span(c.created_on, c.mdt_date), toClose = span(c.created_on, c.closed_on);
  const plotTop = TOP - 6, plotBottom = TOP + cats.length * ROW;

  return (
    <div className="timeline" ref={ref}>
      <div className="spread wrap" style={{ marginBottom: 4 }}>
        <div className="section-title" style={{ margin: 0 }}>{t("tl.title")}</div>
        <div className="row" style={{ gap: 18 }}>
          {toMdt != null && <span className="tl-fig"><b>{toMdt}</b> {t("tl.days")} <span className="muted">{t("tl.toMdt")}</span></span>}
          {toClose != null && <span className="tl-fig"><b>{toClose}</b> {t("tl.days")} <span className="muted">{t("tl.toClose")}</span></span>}
          <span className="xs muted row" style={{ gap: 10 }}>
            <span className="row" style={{ gap: 5 }}><svg width="10" height="10"><circle cx="5" cy="5" r="4" className="tl-dot" /></svg>{t("tl.beforeMdt")}</span>
            <span className="row" style={{ gap: 5 }}><svg width="10" height="10"><circle cx="5" cy="5" r="3.5" className="tl-dot after" /></svg>{t("docs.afterMdt")}</span>
          </span>
        </div>
      </div>
      {width > 0 && (
        <div style={{ position: "relative" }}>
          <svg width={width} height={h} role="img" aria-label={t("tl.title")} style={{ display: "block", overflow: "visible" }}>
            {c.mdt_date && <rect x={x(c.created_on)} y={plotTop} width={Math.max(x(c.mdt_date) - x(c.created_on), 2)} height={plotBottom - plotTop} className="tl-phase" rx={4} />}
            {cats.map((k, i) => (
              <g key={k}>
                <line x1={GUTTER} x2={width - PAD} y1={TOP + i * ROW + ROW / 2} y2={TOP + i * ROW + ROW / 2} className="tl-grid" />
                <text x={0} y={TOP + i * ROW + ROW / 2} dy="0.35em" className="tl-row">{t(`tl.cat.${k}`)}</text>
              </g>
            ))}
            {ticks.map((tk) => (
              <g key={tk.x}>
                <line x1={tk.x} x2={tk.x} y1={plotBottom} y2={plotBottom + 5} className="tl-axis" />
                <text x={tk.x + 4} y={plotBottom + 17} className="tl-tick">{tk.label}</text>
              </g>
            ))}
            <line x1={GUTTER} x2={width - PAD} y1={plotBottom} y2={plotBottom} className="tl-axis" />
            {marks.map((m) => (
              <g key={m.k} className={`tl-mark ${m.k}`}>
                <line x1={m.x} x2={m.x} y1={m.y - 9} y2={plotBottom} />
                <text x={m.anchor === "start" ? m.x + 5 : m.x - 5} y={m.y} textAnchor={m.anchor}>{t(`tl.m.${m.k}`)} · {fmtDate(m.iso).replace(/ \d{4}$/, "")}</text>
              </g>
            ))}
            {points.map((p) => (
              <g key={p.doc.id} className="tl-pt" onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                onClick={() => window.open(`/api/documents/${p.doc.id}/raw`, "_blank")}>
                <circle cx={p.x} cy={TOP + p.row * ROW + ROW / 2} r={12} fill="transparent" />
                <circle cx={p.x} cy={TOP + p.row * ROW + ROW / 2} r={p.after ? 4.5 : 5} className={`tl-dot ${p.after ? "after" : ""} ${hover?.doc.id === p.doc.id ? "on" : ""}`} />
              </g>
            ))}
          </svg>
          {hover && (
            <div className="viz-tip" style={{ left: Math.min(hover.x + 12, width - 260), top: TOP + hover.row * ROW + ROW }}>
              <div style={{ fontWeight: 600 }}>{hover.doc.title || hover.doc.filename}</div>
              <div className="muted">{fmtDate(hover.doc.doc_date)}{hover.doc.facility ? ` · ${hover.doc.facility}` : ""}</div>
              {hover.after && <div className="muted">{t("docs.afterMdt")}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
