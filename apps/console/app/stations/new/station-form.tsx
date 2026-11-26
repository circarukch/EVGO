"use client";

import { useActionState, useState } from "react";
import { createStation, FormState } from "../actions";
import { MapPreview } from "../map-preview";

/** Reads coordinates out of a pasted Google Maps or OpenStreetMap link, or "16.30, 80.43". */
export function coordsFrom(text: string): { lat: number; lng: number } | null {
  const patterns = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|ll|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/, /#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/, /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

export function StationForm({ operators }: { operators: { id: string; name: string }[] }) {
  const [state, submit, saving] = useActionState<FormState, FormData>(createStation, {});
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [paste, setPaste] = useState("");
  const [operator, setOperator] = useState(operators.find((o) => o.id === "org-evgo")?.id ?? operators[0]?.id ?? "__new");
  const pasted = paste ? coordsFrom(paste) : null;

  return (
    <form action={submit} className="card form">
      <label>
        Station name
        <input name="name" required placeholder="Guntur Bus Depot" />
      </label>
      <label>
        City
        <input name="city" required placeholder="Guntur" />
      </label>

      <fieldset>
        <legend>Location</legend>
        <label>
          Paste a Google Maps link or coordinates
          <input
            value={paste}
            placeholder="https://maps.google.com/…@16.3067,80.4365… or 16.3067, 80.4365"
            onChange={(e) => {
              setPaste(e.target.value);
              const c = coordsFrom(e.target.value);
              if (c) {
                setLat(String(c.lat));
                setLng(String(c.lng));
              }
            }}
          />
        </label>
        {paste && !pasted && <p className="hint">No coordinates found in that link. In Google Maps, right-click the spot and copy the numbers.</p>}
        <div className="row">
          <label>
            Latitude
            <input name="lat" required inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="16.3067" />
          </label>
          <label>
            Longitude
            <input name="lng" required inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="80.4365" />
          </label>
        </div>
        <MapPreview lat={Number(lat)} lng={Number(lng)} />
      </fieldset>

      <fieldset>
        <legend>Operator</legend>
        <p className="hint">Who runs this station and gets paid for charging here.</p>
        <select name="operator" value={operator} onChange={(e) => setOperator(e.target.value)}>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
          <option value="__new">New third-party operator…</option>
        </select>
        {operator === "__new" && (
          <label>
            Operator name
            <input name="newOperatorName" required placeholder="Sun Charge Pvt Ltd" />
          </label>
        )}
      </fieldset>

      <label>
        Who can charge
        <select name="access" defaultValue="public">
          <option value="public">Everyone (shown in the app)</option>
          <option value="fleet_only">Our fleet only (hidden from the app)</option>
        </select>
      </label>

      <button type="submit" disabled={saving}>{saving ? "Adding…" : "Add station"}</button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
