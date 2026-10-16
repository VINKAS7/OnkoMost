import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { fmtDate } from "./api";
import { useFetch } from "./hooks";
import type { Notification } from "./types";
import { api } from "./api";
import { LangSwitch, Status, ThemeSwitch } from "./components/ui";
import { AppProvider, useAction, useApp } from "./ctx";
import "./styles.css";
import AckPage from "./pages/AckPage";
import GpPortal from "./pages/gp/GpPortal";
import Home from "./pages/Home";
import CasePage from "./pages/koc/CasePage";
import Dashboard from "./pages/koc/Dashboard";
import Outbox from "./pages/koc/Outbox";
import PathwayEditor from "./pages/koc/PathwayEditor";
import Pathways from "./pages/koc/Pathways";
import ProposalDetail from "./pages/koc/ProposalDetail";
import Proposals from "./pages/koc/Proposals";
import MdtList from "./pages/mdt/MdtList";
import MdtWorkspace from "./pages/mdt/MdtWorkspace";

type Portal = "gp" | "koc" | "mdt";
const PORTALS: Record<Portal, { title: string; nav: [string, string][] }> = {
  gp: { title: "role.gp", nav: [["/gp", "nav.refer"]] },
  koc: { title: "role.koc", nav: [["/koc", "nav.dashboard"], ["/koc/pathways", "nav.pathways"], ["/koc/proposals", "nav.proposals"], ["/koc/outbox", "nav.outbox"]] },
  mdt: { title: "role.mdt", nav: [["/mdt", "nav.meetings"], ["/koc/pathways", "nav.pathways"]] },
};

function Notifications() {
  const { kocId, t, pick } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { data } = useFetch<Notification[]>(`/api/notifications${kocId ? `?koc_id=${kocId}` : ""}`, 20000);
  const items = data ?? [];
  const color = { overdue: "red", due_soon: "orange", question: "purple" } as const;
  return (
    <div style={{ position: "relative" }}>
      <button className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("notif.title")}{items.length ? ` (${items.length})` : ""}
      </button>
      {open && (
        <div className="block" style={{ position: "absolute", right: 0, top: 28, width: 380, maxHeight: 420, overflow: "auto", zIndex: 50, padding: 8, boxShadow: "0 8px 24px rgba(15,15,15,0.14)" }}>
          {!items.length && <div className="small muted" style={{ padding: 6 }}>{t("notif.none")}</div>}
          {items.map((n) => (
            <div key={n.task_id} className="check" style={{ gridTemplateColumns: "12px 1fr", padding: "7px 4px" }}
              onClick={() => { setOpen(false); nav(`/koc/cases/${n.case_id}`); }}>
              <span className={`dot ${color[n.level]}`} />
              <div>
                <div className="small" style={{ fontWeight: 550 }}>{pick(n.title, n.title_en)}</div>
                <div className="meta"><span>{n.patient}</span><span>{t(`notif.${n.level}`)}</span>{n.due_on && <span>{fmtDate(n.due_on)}</span>}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar({ portal }: { portal: Portal }) {
  const { kocs, kocId, setKocId, health, refreshHealth, t } = useApp();
  const { run } = useAction();
  const [editing, setEditing] = useState(false);
  const neoOk = !!health?.neo4j && !health.neo4j.startsWith("ERROR");
  return (
    <header className="topbar">
      {portal !== "gp" && (
        <select value={kocId} onChange={(e) => setKocId(Number(e.target.value))} aria-label={t("top.koc")} style={{ minHeight: 28, border: "none", background: "transparent", fontWeight: 600, paddingLeft: 0 }}>
          <option value={0}>{t("top.all")}</option>
          {kocs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      )}
      <div className="row small muted">
        {editing ? (
          <input type="date" defaultValue={health?.today} autoFocus style={{ minHeight: 28 }}
            onBlur={(e) => { setEditing(false); if (e.target.value && e.target.value !== health?.today) run(() => api.post("/api/clock", { today: e.target.value }), "✓", () => { refreshHealth(); window.dispatchEvent(new Event("onkomost:refresh")); }); }} />
        ) : <button className="linkbtn" title={t("top.date")} onClick={() => setEditing(true)}>{t("top.date")}: {health?.today ?? "—"}</button>}
      </div>
      <div className="row right" style={{ gap: 14 }}>
        {portal !== "gp" && <Notifications />}
        <Status color={health?.medgemma ? "green" : "red"} title={health?.model}>{health?.model ?? "MedGemma"}</Status>
        <Status color={neoOk ? "green" : "red"} title={health?.neo4j}>Neo4j</Status>
        {!!health?.queue && <Status color="yellow">{health.queue} …</Status>}
      </div>
    </header>
  );
}

function Layout({ portal, children }: { portal: Portal; children: ReactNode }) {
  const { t } = useApp();
  const p = PORTALS[portal];
  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="ws" style={{ textDecoration: "none", color: "inherit", flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
          <span>Onkomost</span>
          <span className="xs muted" style={{ fontWeight: 500 }}>{t(p.title)}</span>
        </Link>
        <div style={{ height: 10 }} />
        {p.nav.map(([to, key]) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>{t(key)}</NavLink>
        ))}
        <div className="side-foot">
          <LangSwitch />
          <ThemeSwitch />
          <Link to="/" className="linkbtn">{t("nav.switch")}</Link>
        </div>
      </aside>
      <div className="main">
        <TopBar portal={portal} />
        {children}
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/ack/:token" element={<AckPage />} />
      <Route path="/gp" element={<Layout portal="gp"><GpPortal /></Layout>} />
      <Route path="/koc" element={<Layout portal="koc"><Dashboard /></Layout>} />
      <Route path="/koc/cases/:id" element={<Layout portal="koc"><CasePage /></Layout>} />
      <Route path="/koc/pathways" element={<Layout portal="koc"><Pathways /></Layout>} />
      <Route path="/koc/pathway-versions/:id/edit" element={<Layout portal="koc"><PathwayEditor /></Layout>} />
      <Route path="/koc/proposals" element={<Layout portal="koc"><Proposals /></Layout>} />
      <Route path="/koc/proposals/:id" element={<Layout portal="koc"><ProposalDetail /></Layout>} />
      <Route path="/koc/outbox" element={<Layout portal="koc"><Outbox /></Layout>} />
      <Route path="/mdt" element={<Layout portal="mdt"><MdtList /></Layout>} />
      <Route path="/mdt/cases/:id" element={<Layout portal="mdt"><MdtWorkspace /></Layout>} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
