import { useEffect, useMemo, useRef, useState } from "react";
import Flow, { type Direction } from "./Flow";
import { condText, cycleStatus, evaluate, type Evaluation } from "./engine";
import { dict, type Dict, type Lang } from "./i18n";
import { emptyState, type CaseState, type FactValue, type ManualStatus, type Pathway, type PNode, type SourceRef } from "./types";

// Pathways bundled at build time: the diagnostic pathways of mockup1 (mockup1/seed/pathways/diagnostic) and, read-only
// and optional, the full Onkomost pathways of the main backend (repo-root seed/pathways/*.json).
const DIAGNOSTIC = import.meta.glob<Pathway>("../../seed/pathways/diagnostic/*.json", { eager: true, import: "default" });
const FULL = import.meta.glob<Pathway>("../../../seed/pathways/*.json", { eager: true, import: "default" });
const BUILTIN: { key: string; group: "diagnostic" | "full"; p: Pathway }[] = [
  ...Object.values(DIAGNOSTIC).map((p) => ({ key: `diagnostic/${p.code}`, group: "diagnostic" as const, p })),
  ...Object.values(FULL).map((p) => ({ key: `full/${p.code}`, group: "full" as const, p })),
];

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable – state lives in memory only */
    }
  },
};

// #p=<pathway key>&s=<base64url JSON state> opens a pathway with a given case state (shareable link, demos)
(() => {
  const h = new URLSearchParams(location.hash.slice(1));
  const k = h.get("p");
  if (!k || !BUILTIN.some((x) => x.key === k)) return;
  store.set("pv.key", k);
  const s = h.get("s");
  if (s) {
    try {
      const st = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))) as CaseState;
      store.set(`pv.state.${k}`, { nodes: st.nodes ?? {}, decisions: st.decisions ?? {}, facts: st.facts ?? {} });
    } catch {
      /* ignore a malformed link */
    }
  }
  history.replaceState(null, "", location.pathname);
})();

const download = (name: string, data: unknown) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
const readJson = (f: File) => f.text().then((s) => JSON.parse(s));

export default function App() {
  const [lang, setLang] = useState<Lang>(() => store.get("pv.lang", "cs"));
  const [dir, setDir] = useState<Direction>(() => store.get("pv.dir", "TB"));
  const [uploaded, setUploaded] = useState<{ key: string; group: "uploaded"; p: Pathway }[]>([]);
  const all = useMemo(() => [...BUILTIN, ...uploaded], [uploaded]);
  const [key, setKey] = useState<string>(() => store.get("pv.key", BUILTIN[0]?.key ?? ""));
  const entry = all.find((x) => x.key === key) ?? all[0];
  const p = entry?.p;
  const [state, setState] = useState<CaseState>(emptyState);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"node" | "facts" | "summary" | "sources">("summary");
  const t = dict(lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);

  useEffect(() => store.set("pv.lang", lang), [lang]);
  useEffect(() => store.set("pv.dir", dir), [dir]);
  useEffect(() => {
    if (!entry) return;
    store.set("pv.key", entry.key);
    setState(store.get(`pv.state.${entry.key}`, emptyState()));
    setSelected(null);
  }, [entry?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (fn: (s: CaseState) => CaseState) =>
    setState((s) => {
      const next = fn(s);
      store.set(`pv.state.${entry.key}`, next);
      return next;
    });

  const ev = useMemo(() => (p ? evaluate(p, state) : null), [p, state]);
  const highlight = useMemo(() => {
    if (!ev || !selected) return new Set<string>();
    return new Set(ev.nodes[selected]?.blockers ?? []);
  }, [ev, selected]);

  if (!p || !ev) return <div className="empty">No pathway JSON found in seed/pathways.</div>;
  const node = selected ? p.graph.nodes.find((n) => n.id === selected) : undefined;

  const setStatus = (id: string, s: ManualStatus) =>
    update((st) => {
      const nodes = { ...st.nodes };
      if (s === "missing") delete nodes[id];
      else nodes[id] = s;
      return { ...st, nodes };
    });
  const setDecision = (id: string, keys: string[] | null) =>
    update((st) => {
      const decisions = { ...st.decisions };
      if (keys?.length) decisions[id] = keys;
      else delete decisions[id];
      return { ...st, decisions };
    });
  const setFact = (id: string, v: FactValue | undefined) =>
    update((st) => {
      const facts = { ...st.facts };
      if (v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))) delete facts[id];
      else facts[id] = v;
      return { ...st, facts };
    });
  const allDone = () =>
    update((st) => ({
      ...st,
      nodes: Object.fromEntries(p.graph.nodes.filter((n) => n.type !== "decision" && n.completion !== "auto").map((n) => [n.id, "done" as ManualStatus])),
    }));

  const onOpen = async (f: File | undefined) => {
    if (!f) return;
    try {
      const pw = (await readJson(f)) as Pathway;
      if (!pw?.graph?.nodes) throw new Error("missing graph.nodes");
      const k = `uploaded/${pw.code ?? f.name}`;
      setUploaded((u) => [...u.filter((x) => x.key !== k), { key: k, group: "uploaded", p: pw }]);
      setKey(k);
    } catch (e) {
      alert(`${f.name}: ${(e as Error).message}`);
    }
  };
  const onImportState = async (f: File | undefined) => {
    if (!f) return;
    try {
      const s = (await readJson(f)) as Partial<CaseState> & { state?: CaseState };
      const st = s.state ?? s;
      update(() => ({ nodes: st.nodes ?? {}, decisions: st.decisions ?? {}, facts: st.facts ?? {} }));
    } catch (e) {
      alert(`${f.name}: ${(e as Error).message}`);
    }
  };

  const groups: [string, string][] = [["diagnostic", t.diagnostic], ["full", t.full], ["uploaded", t.uploaded]];
  return (
    <div className="app">
      <header>
        <strong className="brand">{t.title}</strong>
        <label>
          {t.pathway}{" "}
          <select value={entry.key} onChange={(e) => setKey(e.target.value)}>
            {groups.map(([g, gl]) => {
              const items = all.filter((x) => x.group === g);
              return items.length ? (
                <optgroup key={g} label={gl}>
                  {items.map((x) => <option key={x.key} value={x.key}>{(lang === "en" && x.p.name_en) || x.p.name}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <button onClick={() => fileRef.current?.click()}>{t.open}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { onOpen(e.target.files?.[0]); e.target.value = ""; }} />
        <span className="sep" />
        <button onClick={allDone}>{t.allDone}</button>
        <button onClick={() => update(() => emptyState())}>{t.reset}</button>
        <button onClick={() => download(`${p.code}-state.json`, { pathway: p.code, state })}>{t.exportState}</button>
        <button onClick={() => stateRef.current?.click()}>{t.importState}</button>
        <button onClick={() => {
          const s = btoa(unescape(encodeURIComponent(JSON.stringify(state)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          const url = `${location.origin}${location.pathname}#p=${encodeURIComponent(entry.key)}&s=${s}`;
          navigator.clipboard?.writeText(url).then(() => alert(t.copied), () => prompt(t.link, url));
        }}>{t.link}</button>
        <input ref={stateRef} type="file" accept="application/json,.json" hidden onChange={(e) => { onImportState(e.target.files?.[0]); e.target.value = ""; }} />
        <span className="grow" />
        <div className="seg">
          {(["TB", "LR"] as Direction[]).map((d) => <button key={d} className={dir === d ? "on" : ""} onClick={() => setDir(d)}>{d === "TB" ? "↓" : "→"}</button>)}
        </div>
        <div className="seg">
          {(["cs", "en"] as Lang[]).map((l) => <button key={l} className={lang === l ? "on" : ""} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
        </div>
      </header>
      <main>
        <section className="canvas">
          <Flow p={p} ev={ev} lang={lang} t={t} dir={dir} selected={selected} highlight={highlight}
                onSelect={(id) => { setSelected(id); if (id) setTab("node"); }}
                onCycle={(id) => {
                  const n = p.graph.nodes.find((x) => x.id === id);
                  if (n && n.type !== "decision") setStatus(id, cycleStatus(state.nodes[id]) as ManualStatus);
                }} />
          <Legend t={t} />
        </section>
        <aside>
          <nav className="tabs">
            {([["node", t.tabNode], ["facts", t.tabFacts], ["summary", t.tabSummary], ["sources", t.tabSources]] as const).map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {l}{k === "summary" && ev.red.length ? <span className="count">{ev.red.length}</span> : null}
              </button>
            ))}
          </nav>
          <div className="panel">
            {tab === "node" && (node
              ? <NodePanel n={node} p={p} ev={ev} state={state} lang={lang} t={t} setStatus={setStatus} setDecision={setDecision} onSelect={setSelected} />
              : <p className="hint">{t.pick}</p>)}
            {tab === "facts" && <FactsPanel p={p} ev={ev} state={state} t={t} setFact={setFact} />}
            {tab === "summary" && <Summary p={p} ev={ev} lang={lang} t={t} onSelect={(id) => { setSelected(id); setTab("node"); }} />}
            {tab === "sources" && <SourcesPanel p={p} t={t} />}
          </div>
        </aside>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- panels

const nodeLabel = (p: Pathway, id: string, lang: Lang) => {
  const n = p.graph.nodes.find((x) => x.id === id);
  return n ? (lang === "en" && n.label_en) || n.label : id;
};
const factLabel = (p: Pathway) => (id: string) => p.facts?.[id]?.label ?? id;
const words = (t: Dict) => ({ and: t.and, or: t.or, not: t.not, else: t.otherwise });

function NodePanel(props: {
  n: PNode; p: Pathway; ev: Evaluation; state: CaseState; lang: Lang; t: Dict;
  setStatus: (id: string, s: ManualStatus) => void; setDecision: (id: string, k: string[] | null) => void; onSelect: (id: string) => void;
}) {
  const { n, p, ev, state, lang, t, setStatus, setDecision, onSelect } = props;
  const e = ev.nodes[n.id];
  const label = (lang === "en" && n.label_en) || n.label;
  const manual = state.nodes[n.id] ?? "missing";
  const fl = factLabel(p);
  return (
    <div>
      <h2>{label}</h2>
      <p className="meta">
        <span className={`pill v-${e.vstate}`}>{t.v[e.vstate]}</span>
        <span className="mono">{n.id}</span> · {n.kind ?? n.type}{n.owner_role ? ` · ${n.owner_role}` : ""}{n.sla_days ? ` · ${n.sla_days} d` : ""}
      </p>
      {n.description && <p>{n.description}</p>}

      {n.type === "decision" ? (
        <section>
          <h3>{t.decision} <small>({n.decided_by === "rule" ? t.byRule : t.byClinician})</small></h3>
          <div className="btns">
            {n.branches?.map((b) => {
              const on = e.chosen?.includes(b.key);
              const toggle = () => {
                if (!n.multi) return setDecision(n.id, [b.key]);
                const cur = state.decisions[n.id] ?? [];
                setDecision(n.id, cur.includes(b.key) ? cur.filter((k) => k !== b.key) : [...cur, b.key]);
              };
              return <button key={b.key} className={on ? "on" : ""} onClick={toggle} title={b.when ? condText(b.when, fl, words(t)) : ""}>{(lang === "en" && b.label_en) || b.label}</button>;
            })}
          </div>
          {state.decisions[n.id] && <button className="link" onClick={() => setDecision(n.id, null)}>{n.decided_by === "rule" ? t.useRule : t.clear}</button>}
          {e.autoChosen && !state.decisions[n.id] && <p className="hint">{t.byRule}: {e.chosen ? "✓" : t.unknown}</p>}
          {n.branches?.some((b) => b.when) && (
            <ul className="rules">{n.branches.filter((b) => b.when).map((b) => <li key={b.key}><b>{(lang === "en" && b.label_en) || b.label}</b>: {condText(b.when, fl, words(t))}</li>)}</ul>
          )}
          {n.suggest && <p className="hint">{n.suggest}</p>}
        </section>
      ) : n.completion !== "auto" && (
        <section>
          <h3>{t.status}</h3>
          <div className="btns">
            {(["missing", "in_progress", "done", "conflict"] as ManualStatus[]).map((s) => (
              <button key={s} className={`st-${s} ${manual === s ? "on" : ""}`} onClick={() => setStatus(n.id, s)}>{t.m[s]}</button>
            ))}
          </div>
        </section>
      )}

      <dl>
        {e.level && <><dt>{t.level}</dt><dd>{t.lv[e.level]}{n.blocking === false ? " · non-blocking" : ""}{e.downgraded && <em> ({t.downgraded})</em>}</dd></>}
        {n.condition && <><dt>{t.condition}</dt><dd>{condText(n.condition, fl, words(t))} → <b>{e.cond === null ? t.unknown : e.cond ? t.yes : t.no}</b></dd></>}
        {n.level_rules && <><dt>{t.levelRules}</dt><dd>{n.level_rules.map((r, i) => <div key={i}>{condText(r.when, fl, words(t))} → {t.lv[r.level]}</div>)}</dd></>}
        {n.requires?.length ? <><dt>{t.requires}</dt><dd className="mono">{n.requires.map((r) => JSON.stringify(r)).join(" · ")}</dd></> : null}
        {e.vstate === "missing_needed" && e.gates.length > 0 && <><dt>{t.neededBefore}</dt><dd>{e.gates.map((g) => nodeLabel(p, g, lang)).join(", ")}</dd></>}
        {n.waiver && <><dt>{t.waiver}</dt><dd>{(lang === "en" && n.waiver.label_en) || n.waiver.label} → <b>{e.waived ? t.yes : t.no}</b></dd></>}
      </dl>

      {e.blockers.length > 0 && (
        <section>
          <h3>{t.redList}</h3>
          <ul className="links">{e.blockers.map((b) => <li key={b}><button className="link" onClick={() => onSelect(b)}><span className={`dot d-${ev.nodes[b].vstate}`} />{nodeLabel(p, b, lang)}</button></li>)}</ul>
        </section>
      )}

      <Sources refs={[...(n.sources ?? []), ...(n.waiver?.sources ?? [])]} p={p} t={t} />
    </div>
  );
}

function Sources({ refs, p, t }: { refs: SourceRef[]; p: Pathway; t: Dict }) {
  if (!refs.length) return null;
  return (
    <section>
      <h3>{t.sources}</h3>
      {refs.map((s, i) => {
        const def = p.sources?.[s.ref];
        return (
          <div key={i} className={`src role-${s.role}`}>
            <div><span className="role">{t.role[s.role] ?? s.role}</span> {def?.url ? <a href={def.url} target="_blank" rel="noreferrer">{def.title}</a> : (def?.title ?? s.ref)}{s.section && <> · §{s.section}</>}</div>
            {s.quote && <blockquote>„{s.quote}“</blockquote>}
            {s.note && <p className="note">{s.note}</p>}
          </div>
        );
      })}
    </section>
  );
}

function FactsPanel({ p, ev, state, t, setFact }: { p: Pathway; ev: Evaluation; state: CaseState; t: Dict; setFact: (id: string, v: FactValue | undefined) => void }) {
  const facts = Object.entries(p.facts ?? {});
  if (!facts.length) return <p className="hint">—</p>;
  const decisionOf = Object.fromEntries(Object.entries(ev.decisionFact).map(([d, f]) => [f, d]));
  return (
    <table className="facts">
      <tbody>
        {facts.map(([id, def]) => {
          const v = ev.facts[id];
          const origin = ev.factOrigin[id];
          const ro = !!def.derived || id in decisionOf;
          let input;
          if (ro) input = <span className="ro">{v === undefined ? t.unknown : String(v)} <small>({id in decisionOf ? `${t.fromDecision} ${decisionOf[id]}` : t.derived})</small></span>;
          else if (def.type === "bool") input = (
            <select value={state.facts[id] === undefined ? "" : String(state.facts[id])} onChange={(e) => setFact(id, e.target.value === "" ? undefined : e.target.value === "true")}>
              <option value="">{t.unknown}</option><option value="true">{t.yes}</option><option value="false">{t.no}</option>
            </select>);
          else if (def.type === "enum") input = (
            <select value={String(state.facts[id] ?? "")} onChange={(e) => setFact(id, e.target.value || undefined)}>
              <option value="">{t.unknown}</option>{def.values?.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>);
          else input = <input type="number" value={state.facts[id] === undefined ? "" : String(state.facts[id])} onChange={(e) => setFact(id, e.target.value === "" ? undefined : Number(e.target.value))} />;
          return (
            <tr key={id} className={origin ? "set" : ""}>
              <th>{def.label}{def.unit && <small> [{def.unit}]</small>}<div className="mono">{id}</div></th>
              <td>{input}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Summary({ p, ev, lang, t, onSelect }: { p: Pathway; ev: Evaluation; lang: Lang; t: Dict; onSelect: (id: string) => void }) {
  const counts: Record<string, number> = {};
  for (const e of Object.values(ev.nodes)) counts[e.vstate] = (counts[e.vstate] ?? 0) + 1;
  const gates = p.graph.nodes.filter((n) => n.type === "mdt" && ["gate_ready", "gate_waiting", "done"].includes(ev.nodes[n.id].vstate));
  return (
    <div>
      <h2>{(lang === "en" && p.name_en) || p.name}</h2>
      {p.icd_codes && <p className="meta">{p.icd_codes.join(", ")} · {p.status ?? ""} {p.format ? `· ${p.format}` : ""}</p>}
      {p.summary && <p>{p.summary}</p>}
      {gates.map((g) => (
        <p key={g.id} className={`gate v-${ev.nodes[g.id].vstate}`}>
          <b>{nodeLabel(p, g.id, lang)}</b>: {ev.nodes[g.id].vstate === "gate_waiting" ? `${ev.nodes[g.id].blockers.length} ${t.missingFor}` : t.v[ev.nodes[g.id].vstate]}
        </p>
      ))}
      <h3>{t.redList}</h3>
      {ev.red.length ? (
        <ul className="links">{ev.red.map((id) => <li key={id}><button className="link" onClick={() => onSelect(id)}><span className="dot d-missing_needed" />{nodeLabel(p, id, lang)}</button></li>)}</ul>
      ) : <p className="hint">{t.noRed}</p>}
      <h3>{t.counts}</h3>
      <ul className="counts">{Object.entries(counts).map(([k, c]) => <li key={k}><span className={`dot d-${k}`} />{t.v[k] ?? k}: {c}</li>)}</ul>
      {p.notes?.length ? <><h3>{t.notes}</h3><ul>{p.notes.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      <h3>{t.warnings}</h3>
      {ev.warnings.length ? <ul className="warn">{ev.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="hint">{t.noWarnings}</p>}
    </div>
  );
}

function SourcesPanel({ p, t }: { p: Pathway; t: Dict }) {
  const entries = Object.entries(p.sources ?? {});
  if (!entries.length) return <p className="hint">{p.guideline_source ?? "—"}</p>;
  return (
    <div>
      {entries.map(([id, s]) => (
        <div key={id} className={`src role-${s.default_role ?? "structure"}`}>
          <div><span className="role">{t.role[s.default_role ?? "structure"]}</span> <span className="mono">{id}</span></div>
          <div>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</div>
          <p className="note">{[s.edition, s.fetched && `fetched ${s.fetched}`, s.checked && `checked: ${s.checked}`].filter(Boolean).join(" · ")}</p>
          {s.note && <p className="note">{s.note}</p>}
        </div>
      ))}
    </div>
  );
}

function Legend({ t }: { t: Dict }) {
  const items: [string, string][] = [
    ["done", t.v.done], ["in_progress", t.v.in_progress], ["missing_needed", t.v.missing_needed],
    ["missing_optional", t.v.missing_optional], ["undetermined", t.v.undetermined], ["conflict", t.v.conflict],
    ["waived", t.v.waived], ["undecided", t.v.undecided], ["skipped", t.v.skipped],
  ];
  return <div className="legend">{items.map(([k, l]) => <span key={k}><span className={`dot d-${k}`} />{l}</span>)}</div>;
}
