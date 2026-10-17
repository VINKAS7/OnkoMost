import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { fmtDate } from "./api";
import { useFetch } from "./hooks";
import type { Notification } from "./types";
import { api } from "./api";
import { Icon } from "./components/Icon";
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
const PORTALS: Record<Portal, { title: string; nav: [string, string, string][] }> = {
  gp: { title: "role.gp", nav: [["/gp", "nav.refer", "stethoscope"]] },
  koc: {
    title: "role.koc",
    nav: [["/koc", "nav.dashboard", "inbox"], ["/koc/pathways", "nav.pathways", "route"], ["/koc/proposals", "nav.proposals", "vote"], ["/koc/outbox", "nav.outbox", "send"]],
  },
  mdt: { title: "role.mdt", nav: [["/mdt", "nav.meetings", "users"], ["/koc/pathways", "nav.pathways", "route"]] },
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
      <button className="ghost icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} title={t("notif.title")}>
        <Icon name="bell" />
        {t("notif.title")}
        {!!items.length && <span className={`count ${items.some((n) => n.level === "overdue") ? "red" : ""}`}>{items.length}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="section-title" style={{ padding: "8px 8px 2px" }}>{t("notif.title")}</div>
          {!items.length && <div className="small muted" style={{ padding: 8 }}>{t("notif.none")}</div>}
          {items.map((n) => (
            <div key={n.task_id} className="check" style={{ gridTemplateColumns: "12px 1fr", padding: "9px 8px" }}
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
        <select className="koc-pick" value={kocId} onChange={(e) => setKocId(Number(e.target.value))} aria-label={t("top.koc")}>
          <option value={0}>{t("top.all")}</option>
          {kocs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      )}
      {editing ? (
        <input type="date" defaultValue={health?.today} autoFocus style={{ minHeight: 34, width: "auto" }}
          onBlur={(e) => { setEditing(false); if (e.target.value && e.target.value !== health?.today) run(() => api.post("/api/clock", { today: e.target.value }), "✓", () => { refreshHealth(); window.dispatchEvent(new Event("onkomost:refresh")); }); }} />
      ) : (
        <button className="ghost icon-btn" title={t("top.date")} onClick={() => setEditing(true)}>
          <Icon name="calendar" />{t("top.date")}: <b style={{ fontWeight: 600, color: "var(--text)" }}>{health?.today ? fmtDate(health.today) : "—"}</b>
        </button>
      )}
      <div className="row right" style={{ gap: 8 }}>
        {portal !== "gp" && <Notifications />}
        <Status pill color={health?.medgemma ? "green" : "red"} title={health?.model}>{health?.model ?? "MedGemma"}</Status>
        <Status pill color={neoOk ? "green" : "red"} title={health?.neo4j}>Neo4j</Status>
        {!!health?.queue && <Status pill color="yellow">{health.queue} …</Status>}
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
        <Link to="/" className="ws">
          <span className="ws-icon"><Icon name="bridge" /></span>
          <span>
            <div className="ws-name">Onkomost</div>
            <div className="ws-sub">{t(p.title)}</div>
          </span>
        </Link>
        {p.nav.map(([to, key, icon]) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Icon name={icon} />{t(key)}</NavLink>
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
