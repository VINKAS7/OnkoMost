import { Link } from "react-router-dom";
import { fmtDate } from "../../api";
import { Empty, PageHead, StateTag } from "../../components/ui";
import { useApp } from "../../ctx";
import { useFetch } from "../../hooks";
import type { CaseSummary } from "../../types";

export default function MdtList() {
  const { kocId, kocs, setKocId, t, pick } = useApp();
  const { data } = useFetch<CaseSummary[]>("/api/cases?mdt=true", 10000);
  const all = data ?? [];
  const elsewhere = kocs.filter((k) => k.id !== kocId && all.some((c) => c.koc.id === k.id));
  const rows = [...(kocId ? all.filter((c) => c.koc.id === kocId) : all)].sort((a, b) => (a.mdt_date ?? "9999").localeCompare(b.mdt_date ?? "9999"));
  return (
    <div className="page">
      <PageHead title={t("mdt.title")} lead={t("mdt.sub")} />
      {data && !rows.length && elsewhere.length > 0 && (
        <div className="callout yellow"><div className="grow row wrap">{t("koc.elsewhere")}
          {elsewhere.map((k) => <button key={k.id} className="sm" onClick={() => setKocId(k.id)}>{k.name} ({all.filter((c) => c.koc.id === k.id).length})</button>)}
        </div></div>
      )}
      <table>
        <thead><tr><th>MDT</th><th>{t("gp.patient")}</th><th>{t("gp.cancer")}</th><th>{t("mdt.decide")}</th><th /></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td style={{ whiteSpace: "nowrap" }}>{c.mdt_date ? fmtDate(c.mdt_date) : "—"}</td>
              <td><Link to={`/mdt/cases/${c.id}`}><b>{c.patient_name}</b></Link></td>
              <td className="muted">{pick(c.pathway.name, c.pathway.name_en)} · {c.koc.code}</td>
              <td>{c.treatments.map((k) => t(`tr.${k}`)).join(", ") || <span className="faint">—</span>}</td>
              <td style={{ textAlign: "right" }}><StateTag state={c.state} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && !rows.length && <Empty>{t("mdt.empty")}</Empty>}
    </div>
  );
}
