"use client";

import { useActionState } from "react";
import { ChargerProduct, SITE_TYPES, specsToText } from "../../lib/shop";
import { ProductFormState, saveProduct } from "./actions";

export function ProductForm({ product }: { product?: ChargerProduct }) {
  const [state, submit, saving] = useActionState<ProductFormState, FormData>(saveProduct, {});
  const p = product;
  return (
    <form action={submit} className="card form">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="row">
        <label>
          Product name
          <input name="name" required defaultValue={p?.name} placeholder="Home 7.4 kW wall box" />
        </label>
        <label>
          Brand or maker
          <input name="brand" defaultValue={p?.brand} placeholder="Exicom, Delta, Statiq…" />
        </label>
      </div>
      <div className="row">
        <label>
          Type
          <select name="current" defaultValue={p?.current ?? "AC"}>
            <option value="AC">AC</option>
            <option value="DC">DC fast</option>
          </select>
        </label>
        <label>
          Power (kW)
          <input name="powerKw" type="number" step="0.1" min="0.1" required defaultValue={p?.powerKw} />
        </label>
        <label>
          Price (₹, incl. GST)
          <input name="priceInr" inputMode="numeric" defaultValue={p?.priceInr ?? ""} placeholder="Empty = price on quote" />
        </label>
        <label>
          Warranty (years)
          <input name="warrantyYears" type="number" min="0" max="15" defaultValue={p?.warrantyYears ?? 2} />
        </label>
      </div>
      <label>
        Connectors (comma-separated)
        <input name="connectors" defaultValue={p?.connectors.join(", ")} placeholder="Type 2, CCS2" />
      </label>
      <fieldset>
        <legend>Suited for</legend>
        {[...SITE_TYPES, "2W / 3W", "4W", "Truck"].map((s) => (
          <label key={s} className="check">
            <input type="checkbox" name="suitedFor" value={s} defaultChecked={p?.suitedFor.includes(s)} /> {s}
          </label>
        ))}
      </fieldset>
      <label>
        Short description (shown in the app)
        <textarea name="summary" required rows={2} defaultValue={p?.summary} />
      </label>
      <label>
        Specifications, one per line as Name: value
        <textarea name="specs" rows={5} defaultValue={p ? specsToText(p.specs) : ""} placeholder={"Input: 230 V single phase, 32 A\nProtection: IP55"} />
      </label>
      <div>
        <label className="check">
          <input type="checkbox" name="installationIncluded" defaultChecked={p?.installationIncluded ?? false} /> Standard installation included
        </label>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Show in the app
        </label>
        <label className="check">
          <input type="checkbox" name="isSample" defaultChecked={p?.isSample ?? false} /> Sample (placeholder) listing
        </label>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" disabled={saving}>{saving ? "Saving…" : p ? "Save changes" : "Add product"}</button>{" "}
      <a className="button secondary" href="/shop">Cancel</a>
    </form>
  );
}
