import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { LangSwitch, ThemeSwitch } from "../components/ui";
import { useApp } from "../ctx";

export default function Home() {
  const { t } = useApp();
  const roles = [
    { to: "/gp", title: "role.gp", d: "role.gp.d", icon: "stethoscope", color: "blue" },
    { to: "/koc", title: "role.koc", d: "role.koc.d", icon: "hospital", color: "teal" },
    { to: "/mdt", title: "role.mdt", d: "role.mdt.d", icon: "users", color: "purple" },
  ];
  return (
    <div className="dotted" style={{ minHeight: "100vh" }}>
      <div className="page" style={{ maxWidth: 1040, paddingTop: 56 }}>
        <div className="spread">
          <div className="ws" style={{ padding: 0 }}>
            <span className="ws-icon"><Icon name="bridge" /></span>
            <span><div className="ws-name">Onkomost</div><div className="ws-sub">OncoBridge</div></span>
          </div>
          <div className="row"><ThemeSwitch /><LangSwitch /></div>
        </div>
        <div style={{ marginTop: 48 }}>
          <h1 style={{ fontSize: 40, letterSpacing: "-0.03em" }}>{t("role.title")}</h1>
          <div className="lead" style={{ fontSize: 17 }}>{t("role.sub")}</div>
        </div>
        <div className="roles">
          {roles.map((r) => (
            <Link key={r.to} to={r.to} className="role">
              <span className="role-ic" style={{ background: `var(--${r.color}-bg)`, color: `var(--${r.color})` }}><Icon name={r.icon} /></span>
              <h3 style={{ fontSize: 18 }}>{t(r.title)}</h3>
              <span className="muted">{t(r.d)}</span>
              <span className="go">{t("role.open")}<Icon name="arrow" /></span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
