import { adminFetch } from "../../../lib/api";
import { ChargerLead, LEAD_LABEL, LEAD_STATUSES, LeadStatus } from "../../../lib/shop";
import { StatusSelect } from "./status-select";

export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = LEAD_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined;
  const res = await adminFetch(`/admin/shop/leads${filter ? `?status=${filter}` : ""}`).catch(() => null);
  if (!res?.ok) return <p className="error">Could not reach the EVGO API.</p>;
  const leads: ChargerLead[] = await res.json();
  return (
    <main>
      <p><a href="/shop">← Charger shop</a></p>
      <h1>Charger enquiries</h1>
      <p>Quote requests from the app, newest first. Call the customer, then move the status along.</p>
      <p>
        <a className={`button small ${filter ? "secondary" : ""}`} href="/shop/leads">All</a>
        {LEAD_STATUSES.map((s) => (
          <a key={s} className={`button small ${filter === s ? "" : "secondary"}`} href={`/shop/leads?status=${s}`}>{LEAD_LABEL[s]}</a>
        ))}
      </p>
      {leads.length === 0 ? (
        <p className="hint">No enquiries {filter ? `marked ${LEAD_LABEL[filter]}` : "yet"}.</p>
      ) : (
        <table className="wide">
          <thead>
            <tr>
              <th align="left">When</th>
              <th align="left">Customer</th>
              <th align="left">Wants</th>
              <th align="left">Site</th>
              <th align="left">Status</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td className="hint">{when(l.createdAt)}</td>
                <td>
                  <b>{l.name}</b>
                  <div><a href={`tel:+91${l.phone}`}>+91 {l.phone}</a></div>
                </td>
                <td>
                  {l.productName ?? <span className="hint">Help choosing</span>}
                  {l.quantity > 1 && <> × {l.quantity}</>}
                  {l.notes && <div className="hint">{l.notes}</div>}
                </td>
                <td>
                  {l.siteType}
                  <div className="hint">{l.city}</div>
                </td>
                <td><StatusSelect id={l.id} status={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
