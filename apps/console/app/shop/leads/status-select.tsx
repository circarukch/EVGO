"use client";

import { LEAD_LABEL, LEAD_STATUSES, LeadStatus } from "../../../lib/shop";
import { setLeadStatus } from "../actions";

/** Changes an enquiry's status as soon as a new one is picked. */
export function StatusSelect({ id, status }: { id: string; status: LeadStatus }) {
  return (
    <form action={setLeadStatus} className="inline">
      <input type="hidden" name="id" value={id} />
      <select name="status" defaultValue={status} aria-label="Status" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>{LEAD_LABEL[s]}</option>
        ))}
      </select>
    </form>
  );
}
