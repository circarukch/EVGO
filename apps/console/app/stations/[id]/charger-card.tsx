"use client";

import { useActionState } from "react";
import type { ChargerView } from "../../../lib/stations";
import { chargerAction, FormState, newPassword } from "../actions";
import { ConnectionBox } from "./connection-box";

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function ChargerCard({ siteId, charger: c }: { siteId: string; charger: ChargerView }) {
  const [act, doAct, acting] = useActionState<FormState, FormData>(chargerAction, {});
  const [pw, doPw, making] = useActionState<FormState, FormData>(newPassword, {});

  const Action = ({ action, connectorId, label, type, kind }: { action: string; connectorId?: number; label: string; type?: string; kind?: string }) => (
    <form action={doAct} className="inline">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="chargePointId" value={c.chargePointId} />
      <input type="hidden" name="action" value={action} />
      {connectorId && <input type="hidden" name="connectorId" value={connectorId} />}
      {type && <input type="hidden" name="type" value={type} />}
      <button type="submit" className={`small ${kind ?? "secondary"}`} disabled={acting || !c.online}>{label}</button>
    </form>
  );

  return (
    <section className="card">
      <div className="head">
        <h3>
          <span className={`dot ${c.online ? "on" : "off"}`} aria-hidden /> {c.chargePointId}{" "}
          <span className={c.online ? "ok" : "hint"}>{c.online ? "Online" : "Offline"}</span>
        </h3>
        <div>
          <Action action="reset" label="Restart" type="Soft" />
          <Action action="reset" label="Hard restart" type="Hard" />
          <a className="button secondary small" href={`/stations/${siteId}/qr/${encodeURIComponent(c.chargePointId)}`} target="_blank">Print QR codes</a>
        </div>
      </div>
      <p className="hint">
        {[c.vendor, c.model, c.firmware && `firmware ${c.firmware}`].filter(Boolean).join(" · ") || "Make and model appear when it connects"} · last heard{" "}
        <span suppressHydrationWarning>{ago(c.lastSeenAt)}</span>
      </p>

      <table className="wide">
        <thead>
          <tr>
            <th align="left">Plug</th>
            <th align="left">Type</th>
            <th align="left">Power</th>
            <th align="left">Price</th>
            <th align="left">Vehicles</th>
            <th align="left">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {c.connectors.map((k) => (
            <tr key={k.id}>
              <td>{k.id}</td>
              <td>{k.label} <span className="tag">{k.current}</span></td>
              <td>{k.powerKw} kW</td>
              <td>{k.pricePerKwhInr != null ? `₹${k.pricePerKwhInr}/kWh` : "–"}</td>
              <td>{k.segments.join(", ")}</td>
              <td className={`status-${k.status}`}>{k.status}</td>
              <td className="actions">
                {k.status === "Charging" ? <Action action="stop" connectorId={k.id} label="Stop" kind="danger" /> : <Action action="start" connectorId={k.id} label="Start" />}
                <Action action="unlock" connectorId={k.id} label="Unlock" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!c.online && <p className="hint">Commands are available when the charger is online.</p>}
      {act.ok && <p className="ok">{act.ok}</p>}
      {act.error && <p className="error">{act.error}</p>}

      <details>
        <summary>Connection details</summary>
        <table>
          <tbody>
            <tr><th align="left">Central system URL</th><td><code>{c.ocppUrl}</code></td></tr>
            <tr><th align="left">Charge point ID</th><td><code>{c.chargePointId}</code></td></tr>
            <tr><th align="left">Password</th><td>{c.hasPassword ? "Set (hidden)" : "None"}</td></tr>
          </tbody>
        </table>
        <form action={doPw}>
          <input type="hidden" name="chargePointId" value={c.chargePointId} />
          <button type="submit" className="secondary small" disabled={making}>Make a new password</button>
          <span className="hint"> The old password stops working straight away.</span>
        </form>
        {pw.error && <p className="error">{pw.error}</p>}
        {pw.connection && <ConnectionBox c={pw.connection} />}
      </details>
    </section>
  );
}
