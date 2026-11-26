"use client";

import { useActionState } from "react";
import type { Operator } from "../../../lib/api";
import { resetPolicy, savePolicy, SaveState } from "./actions";

const ROWS = 4;

export function PolicyForm({ operator }: { operator: Operator }) {
  const [saved, save, saving] = useActionState<SaveState, FormData>(savePolicy, {});
  const [reset, doReset, resetting] = useActionState<SaveState, FormData>(resetPolicy, {});
  const tiers = operator.cancellationPolicy.tiers;
  const state = reset.ok || reset.error ? reset : saved;
  return (
    <section className="card">
      <h2>
        {operator.name} {operator.cancellationPolicy.isDefault && <span className="tag">EVGO default</span>}
      </h2>
      <form action={save}>
        <input type="hidden" name="orgId" value={operator.id} />
        <table>
          <thead>
            <tr>
              <th align="left">Cancelled at least (hours before departure)</th>
              <th align="left">Refund to wallet (%)</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, i) => (
              <tr key={i}>
                <td>
                  <input name="minHoursBefore" type="number" min={0} max={720} step="any" defaultValue={tiers[i]?.minHoursBefore ?? ""} aria-label={`Tier ${i + 1} hours`} />
                </td>
                <td>
                  <input name="refundPercent" type="number" min={0} max={100} step={1} defaultValue={tiers[i]?.refundPercent ?? ""} aria-label={`Tier ${i + 1} refund percent`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Cancellation closes below the smallest number of hours. Leave a row empty to remove it.
        </p>
        <div className="row">
          <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
      {!operator.cancellationPolicy.isDefault && (
        <form action={doReset}>
          <input type="hidden" name="orgId" value={operator.id} />
          <button type="submit" className="secondary" disabled={resetting}>Use EVGO default</button>
        </form>
      )}
      {state.ok && <p className="ok">{state.ok}</p>}
      {state.error && <p className="error">{state.error}</p>}
    </section>
  );
}
