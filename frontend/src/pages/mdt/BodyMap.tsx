import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Anatomogram from "@ebi-gene-expression-group/anatomogram";
import { api, fmtDate } from "../../api";
import { Spinner } from "../../components/ui";
import { useApp } from "../../ctx";
import type { BodyMap as BodyMapData, BodySite, BodyStatus } from "../../types";

// Fixed colours: the figure sits on a light card in both themes.
export const BODY_COLOURS: Record<BodyStatus, string> = {
  primary: "#d44c47", metastasis: "#9065b0", involved: "#e07b1f", suspicious: "#d9a521", negative: "#448361",
};
const OPACITY = 0.55;
const ALPHA: Record<BodyStatus, number> = { primary: 0.9, metastasis: 0.85, involved: 0.65, suspicious: 0.65, negative: 0.35 };
// the vessel tissue is the whole arterial tree – keep it faint so the organs stay readable
const alpha = (s: BodySite) => (s.organ === "blood_vessel" ? Math.min(0.35, ALPHA[s.status]) : ALPHA[s.status]);
const ATLAS_URL = new URL("/", window.location.href).href;

/** Same lookup the library uses: tissues live in <g id="LAYER_EFO">, some as <use> links to another tissue. */
function findTissue(svg: SVGSVGElement, id: string): SVGElement | null {
  const layer = svg.querySelector("g#LAYER_EFO");
  const el = layer ? Array.from(layer.children).find((c) => c.id === id) : null;
  const href = el?.getAttribute("xlink:href") ?? el?.getAttribute("href");
  return href ? findTissue(svg, href.slice(1)) : ((el as SVGElement | null) ?? null);
}

type FigureProps = {
  ids: string[];
  onHover: (ids: string[] | null) => void;
  onPick: (ids: string[]) => void;
  onReady: (svg: SVGSVGElement) => void;
};

// Memoised with stable props: the library re-injects the SVG whenever it re-renders.
const Figure = memo(function Figure({ ids, onHover, onPick, onReady }: FigureProps) {
  return (
    <Anatomogram
      species="homo_sapiens" atlasUrl={ATLAS_URL}
      showIds={ids} showColour="#9b9b9b" showOpacity={OPACITY}
      onMouseOver={(list) => onHover(list)} onMouseOut={() => onHover(null)} onClick={(list) => onPick(list)}
      onInjected={(error, svg) => { if (!error) onReady(svg); }}
    />
  );
});

export type BodyFilter = { organ: string; docIds: number[] } | null;

/**
 * MDT body map: the LLM reads the reports up to the MDT date and lists the organs affected by the cancer;
 * they are coloured on the EBI Expression Atlas anatomogram. Clicking an organ filters the brief and the documents.
 */
export default function BodyMap({ caseId, filter, onFilter, hoverDoc }: {
  caseId: number; filter: BodyFilter; onFilter: (f: BodyFilter) => void; hoverDoc: number | null;
}) {
  const { t, pick, health } = useApp();
  const [data, setData] = useState<BodyMapData | null>(null);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [hoverIds, setHoverIds] = useState<string[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const started = useRef(false);
  const switched = useRef(false);

  const load = useCallback(() => api.get<BodyMapData>(`/api/cases/${caseId}/bodymap`).then(setData).catch(() => undefined), [caseId]);
  const run = useCallback(() => api.post<BodyMapData>(`/api/cases/${caseId}/bodymap`).then(setData).catch(() => undefined), [caseId]);
  useEffect(() => { started.current = false; switched.current = false; setData(null); load(); }, [load]);
  // first visit (or new reports since the last run): start the LLM automatically
  useEffect(() => {
    if (!data || started.current || data.job.status === "running" || !health?.llm) return;
    if (data.stale) { started.current = true; run(); }
  }, [data, health?.llm, run]);
  const running = data?.job.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [running, load]);

  const sites = useMemo(() => data?.result?.sites ?? [], [data?.result]);
  const ids = useMemo(() => sites.flatMap((s) => s.uberon), [sites]);
  const siteOf = useCallback((list: string[]) => sites.find((s) => s.uberon.some((u) => list.includes(u))) ?? null, [sites]);
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const sex = data?.sex ?? data?.result?.sex;
  const sexRef = useRef(sex);
  sexRef.current = sex;
  // remount the figure when the colours change (the library only paints on inject)
  const figKey = sites.map((s) => `${s.organ}:${s.status}`).join("|");
  useEffect(() => { switched.current = false; }, [figKey]);

  const onHover = useCallback((list: string[] | null) => setHoverIds(list), []);
  const onPick = useCallback((list: string[]) => {
    const s = sitesRef.current.find((x) => x.uberon.some((u) => list.includes(u)));
    if (s) onFilter({ organ: s.organ, docIds: s.evidence.map((e) => e.doc_id) });
  }, [onFilter]);
  const onReady = useCallback((node: SVGSVGElement) => {
    // open the patient's own figure once (the library starts with the male one)
    const female = node.closest(".bodymap")?.querySelector<HTMLImageElement>('img[src*="female.unselected"]');
    if (sexRef.current === "female" && female && !switched.current) { switched.current = true; female.click(); return; }
    // colour each organ by its status; the library would repaint them grey/red on hover
    for (const s of sitesRef.current) {
      for (const id of s.uberon) {
        const el = findTissue(node, id);
        if (!el) continue;
        const paint = (hover: boolean) => () => {
          el.style.fill = BODY_COLOURS[s.status];
          el.style.opacity = String(Math.min(1, alpha(s) + (hover ? 0.2 : 0)));
        };
        paint(false)();
        el.addEventListener("mouseover", paint(true));
        el.addEventListener("mouseout", paint(false));
      }
    }
    setMissing(sitesRef.current.filter((s) => !s.uberon.some((id) => findTissue(node, id))).map((s) => s.organ));
    setSvg(node);
  }, []);

  // outline the organ in focus: hovered on the figure, mentioned by the hovered report, or picked
  const focus = useMemo(() => {
    if (hoverIds) return new Set(siteOf(hoverIds)?.uberon ?? []);
    if (hoverDoc) return new Set(sites.filter((s) => s.evidence.some((e) => e.doc_id === hoverDoc)).flatMap((s) => s.uberon));
    if (filter) return new Set(sites.find((s) => s.organ === filter.organ)?.uberon ?? []);
    return new Set<string>();
  }, [hoverIds, hoverDoc, filter, sites, siteOf]);
  useEffect(() => {
    if (!svg) return;
    for (const s of sites) {
      for (const id of s.uberon) {
        const el = findTissue(svg, id);
        if (!el) continue;
        const on = focus.has(id);
        el.style.stroke = on ? "#1f1f1f" : "";
        el.style.strokeWidth = on ? "1.5" : "";
        el.style.opacity = String(on ? Math.max(0.9, alpha(s)) : alpha(s));
      }
    }
  }, [svg, sites, focus]);

  const pickSite = (s: BodySite) => onFilter(filter?.organ === s.organ ? null : { organ: s.organ, docIds: s.evidence.map((e) => e.doc_id) });
  const label = (s: BodySite) => pick(s.label, s.label_en);
  const side = (s: BodySite) => (s.side ? ` · ${t(`bm.side.${s.side}`)}` : "");

  return (
    <section className="col bodymap" style={{ gap: 10 }}>
      <div>
        <div className="section-title" style={{ margin: 0 }}>{t("bm.title")}</div>
        <div className="xs muted">{t("bm.sub")}</div>
      </div>
      <div className="bodymap-figure">
        {data?.result ? <Figure key={figKey} ids={ids} onHover={onHover} onPick={onPick} onReady={onReady} /> :
          <div className="xs muted" style={{ padding: 16 }}>{running ? t("bm.first") : t("bm.none")}</div>}
      </div>
      <div className="bodymap-legend">
        {(Object.keys(BODY_COLOURS) as BodyStatus[]).map((k) => (
          <span key={k}><i style={{ background: BODY_COLOURS[k] }} />{t(`bm.st.${k}`)}</span>
        ))}
      </div>

      <div className="row wrap xs muted" style={{ gap: 8 }}>
        {running ? <><Spinner /> {t("bm.reading")} {data?.job.done ?? 0}/{data?.job.total || "…"}</> :
          <>
            {data?.result && <span>LLM · {fmtDate(data.result.computed_on)}</span>}
            {data?.stale && data?.result && <span style={{ color: "var(--yellow)" }}>{t("bm.stale")}</span>}
            {data?.job.status === "error" && <span style={{ color: "var(--red)" }}>{data.job.error}</span>}
            {health && !health.llm && <span>{t("top.ai.off")}</span>}
            <button className="sm ghost right" disabled={!health?.llm} onClick={() => { started.current = true; run(); }}>{t("bm.rerun")}</button>
          </>}
      </div>

      {filter && (
        <div className="row xs" style={{ gap: 8 }}>
          <span className="muted">{t("bm.filtered")}</span>
          <b>{label(sites.find((s) => s.organ === filter.organ) ?? sites[0])}</b>
          <button className="sm ghost" onClick={() => onFilter(null)}>{t("bm.showAll")}</button>
        </div>
      )}

      <div className="col" style={{ gap: 0 }}>
        {sites.map((s) => (
          <div key={s.organ} role="button" tabIndex={0} className={`bm-site ${filter?.organ === s.organ ? "on" : ""}`}
            onClick={() => pickSite(s)} onKeyDown={(e) => e.key === "Enter" && pickSite(s)}
            onMouseEnter={() => setHoverIds(s.uberon)} onMouseLeave={() => setHoverIds(null)}>
            <div className="row" style={{ gap: 8 }}>
              <i className="bm-dot" style={{ background: BODY_COLOURS[s.status] }} />
              <b className="small">{label(s)}</b>
              <span className="xs muted">{t(`bm.st.${s.status}`)}{side(s)}</span>
              {s.conflict && <span className="tag yellow right" title={t("bm.conflict.d")}>{t("bm.conflict")}</span>}
            </div>
            {missing.includes(s.organ) && <div className="xs faint">{t("bm.notInView")}</div>}
            {s.from_pathway && <div className="xs faint">{t("bm.fromPathway")}</div>}
            {filter?.organ === s.organ && s.evidence.map((e, i) => (
              <div key={i} className="xs muted bm-quote">
                „{e.quote}“ <a className="cite" href={`/api/documents/${e.doc_id}/raw`} onClick={(ev) => ev.stopPropagation()}>D{e.doc_id}</a>
                <span className="faint">{fmtDate(e.date)} · {t(`bm.st.${e.status}`)}</span>
              </div>
            ))}
          </div>
        ))}
        {data?.result && !sites.length && <div className="xs muted">{t("bm.empty")}</div>}
      </div>
    </section>
  );
}
