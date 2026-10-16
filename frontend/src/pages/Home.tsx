import { Link } from "react-router-dom";
import { LangSwitch, ThemeSwitch } from "../components/ui";
import { useApp } from "../ctx";

export default function Home() {
  const { t } = useApp();
  const roles = [
    { to: "/gp", title: "role.gp", d: "role.gp.d" },
    { to: "/koc", title: "role.koc", d: "role.koc.d" },
    { to: "/mdt", title: "role.mdt", d: "role.mdt.d" },
  ];
  return (
    <div className="page" style={{ maxWidth: 960, paddingTop: 80 }}>
      <div className="spread">
        <div className="row"><b style={{ fontSize: 16 }}>Onkomost</b><span className="muted small">OncoBridge</span></div>
        <div className="row"><ThemeSwitch /><LangSwitch /></div>
      </div>
      <div style={{ marginTop: 32 }}>
        <h1 style={{ fontSize: 34 }}>{t("role.title")}</h1>
        <div className="lead">{t("role.sub")}</div>
      </div>
      <div className="roles">
        {roles.map((r) => (
          <Link key={r.to} to={r.to} className="role">
            <b style={{ fontSize: 16 }}>{t(r.title)}</b>
            <span className="muted small">{t(r.d)}</span>
            <span className="small muted" style={{ marginTop: "auto" }}>→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
