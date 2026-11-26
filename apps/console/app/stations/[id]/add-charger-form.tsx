"use client";

import { useActionState, useRef, useState } from "react";
import { PLUG_TYPES, VEHICLES } from "../../../lib/stations";
import { addCharger, FormState } from "../actions";
import { ConnectionBox } from "./connection-box";

type Row = { key: number; type: string };

export function AddChargerForm({ siteId }: { siteId: string }) {
  const [state, submit, saving] = useActionState<FormState, FormData>(addCharger, {});
  const next = useRef(2);
  const [rows, setRows] = useState<Row[]>([{ key: 1, type: "CCS2" }]);
  const current = (t: string) => PLUG_TYPES.find((p) => p.value === t)?.current ?? "";

  return (
    <section className="card">
      <h2>Add charger</h2>
      {state.connection ? (
        <>
          <p className="ok">{state.ok}</p>
          <ConnectionBox c={state.connection} />
          <p className="hint">The charger shows as Online here as soon as it connects with these details.</p>
          <button type="button" className="secondary" onClick={() => location.reload()}>Add another charger</button>
        </>
      ) : (
        <form action={submit} className="form">
          <input type="hidden" name="siteId" value={siteId} />
          <div className="row">
            <label>
              Charge point ID
              <input name="chargePointId" required placeholder="GNT-HUB-03" pattern="[A-Za-z0-9._\-]{3,48}" title="3 to 48 letters, digits, dots, dashes or underscores" />
              <span className="hint">Unique. Also the username the charger logs in with.</span>
            </label>
            <label>
              Make
              <input name="vendor" placeholder="Exicom" />
            </label>
            <label>
              Model
              <input name="model" placeholder="Harbor 120" />
            </label>
          </div>

          <table className="wide plugs">
            <thead>
              <tr>
                <th align="left">Plug</th>
                <th align="left">Type</th>
                <th align="left">AC/DC</th>
                <th align="left">Power (kW)</th>
                <th align="left">Price (₹/kWh)</th>
                <th align="left">Vehicles</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td>{i + 1}</td>
                  <td>
                    <select name="type" value={r.type} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, type: e.target.value } : x)))} aria-label={`Plug ${i + 1} type`}>
                      {PLUG_TYPES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </td>
                  <td><span className="tag">{current(r.type)}</span></td>
                  <td><input name="powerKw" type="number" required min={1} max={1000} step="any" placeholder={current(r.type) === "DC" ? "120" : "22"} aria-label={`Plug ${i + 1} power`} /></td>
                  <td><input name="price" type="number" required min={1} max={100} step="0.01" placeholder="18" aria-label={`Plug ${i + 1} price`} /></td>
                  <td className="vehicles">
                    {VEHICLES.map((v) => (
                      <label key={v} className="check">
                        <input type="checkbox" name={`seg-${i}`} value={v} defaultChecked={v === "4W"} /> {v}
                      </label>
                    ))}
                  </td>
                  <td>
                    {rows.length > 1 && (
                      <button type="button" className="secondary small" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length < 8 && (
            <button type="button" className="secondary small" onClick={() => setRows([...rows, { key: next.current++, type: "CCS2" }])}>+ Add plug</button>
          )}
          <div>
            <button type="submit" disabled={saving}>{saving ? "Adding…" : "Add charger and make its password"}</button>
          </div>
          {state.error && <p className="error">{state.error}</p>}
        </form>
      )}
    </section>
  );
}
