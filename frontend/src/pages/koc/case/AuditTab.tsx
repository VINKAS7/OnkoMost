import { fmtDate } from "../../../api";
import { useFetch } from "../../../hooks";
import type { CaseDetail } from "../../../types";

type Entry = { on: string; at: string; actor: string; action: string; detail: Record<string, unknown> };

export default function AuditTab({ c }: { c: CaseDetail }) {
  const { data } = useFetch<Entry[]>(`/api/cases/${c.id}/audit`);
  return (
    <div style={{ overflowX: "auto" }}>
      
      <table>
        <thead><tr><th>Date</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          {(data ?? []).map((e, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.on)}</td>
              <td className="small">{e.actor}</td>
              <td><span className="tag">{e.action}</span></td>
              <td className="mono small" style={{ wordBreak: "break-word" }}>{Object.entries(e.detail).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
