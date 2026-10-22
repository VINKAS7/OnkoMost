import { useEffect, useRef, useState } from "react";
import { api, fmtDate } from "../api";
import { useApp } from "../ctx";
import { Spinner } from "./ui";

/** Spread on a file input to pick a whole folder (a CT export is one file per slice). Not in React's types yet. */
export const FOLDER = { webkitdirectory: "", directory: "" } as Record<string, string>;

type SeriesMeta = {
  modality: string; body_part: string; slices: number; rows: number; columns: number; slice_thickness: number | null;
  study_date: string | null; manufacturer: string; description: string; identity_removed: boolean; windows: string[];
};

/** One CT / MRI / PET series: scroll with the wheel, the slider or the arrow keys; switch the window. */
export function CtViewer({ docId }: { docId: number }) {
  const { t } = useApp();
  const [meta, setMeta] = useState<SeriesMeta | null>(null);
  const [error, setError] = useState("");
  const [i, setI] = useState(0);
  const [win, setWin] = useState("lung");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMeta(null);
    setError("");
    api.get<SeriesMeta>(`/api/documents/${docId}/series`)
      .then((m) => { setMeta(m); setI(Math.floor(m.slices / 2)); })
      .catch((e) => setError((e as Error).message));
  }, [docId]);
  const n = meta?.slices ?? 0;
  const src = (k: number) => `/api/documents/${docId}/slice/${k}.png?window=${win}`;
  useEffect(() => {  // warm the browser cache for the neighbouring slices
    if (!n) return;
    for (const k of [i - 2, i - 1, i + 1, i + 2]) if (k >= 0 && k < n) new Image().src = src(k);
  }, [i, n, win]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // a non-passive wheel listener, so scrolling the slices does not scroll the page
    const el = box.current;
    if (!el || !n) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setI((k) => Math.max(0, Math.min(n - 1, k + Math.sign(e.deltaY)))); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [n]);
  if (error) return <div className="xs" style={{ color: "var(--red)" }}>{error}</div>;
  if (!meta) return <div className="row xs muted" style={{ gap: 8 }}><Spinner />{t("ct.loading")}</div>;
  const step = (d: number) => setI((k) => Math.max(0, Math.min(n - 1, k + d)));
  return (
    <div className="col" style={{ gap: 8 }}>
      <div ref={box} tabIndex={0} title={t("ct.hint")}
        onKeyDown={(e) => { if (["ArrowUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); step(-1); }
                            if (["ArrowDown", "ArrowRight"].includes(e.key)) { e.preventDefault(); step(1); } }}
        style={{ background: "#000", borderRadius: "var(--radius)", aspectRatio: `${meta.columns || 1} / ${meta.rows || 1}`,
                 maxWidth: 520, width: "100%", outline: "none", cursor: "ns-resize", position: "relative" }}>
        <img src={src(i)} alt={`${meta.modality} ${i + 1}/${n}`} draggable={false}
          style={{ width: "100%", height: "100%", display: "block", borderRadius: "var(--radius)" }} />
        <span className="xs" style={{ position: "absolute", left: 8, top: 6, color: "#ddd" }}>{i + 1} / {n}</span>
      </div>
      <input type="range" min={0} max={n - 1} value={i} onChange={(e) => setI(Number(e.target.value))} style={{ maxWidth: 520 }} />
      <div className="row wrap" style={{ gap: 6 }}>
        {meta.windows.map((w) => (
          <button key={w} className={`sm ${w === win ? "primary" : ""}`} onClick={() => setWin(w)}>{t(`ct.win.${w}`)}</button>
        ))}
      </div>
      <div className="xs muted">
        {[meta.modality, meta.body_part, `${n} ${t("ct.slices")}`, meta.slice_thickness ? `${meta.slice_thickness} mm` : "",
          meta.manufacturer, meta.study_date ? `${t("ct.imageDate")} ${fmtDate(meta.study_date)}` : ""].filter(Boolean).join(" · ")}
      </div>
      {meta.identity_removed && <div className="xs" style={{ color: "var(--orange)" }}>{t("ct.deidentified")}</div>}
    </div>
  );
}
