"use client";

import { useActionState } from "react";
import { changePassword, PasswordState } from "./actions";

export function PasswordForm({ first }: { first: boolean }) {
  const [state, submit, busy] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={submit} className="card form login">
      <label>
        {first ? "Temporary password" : "Current password"}
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label>
        New password (at least 10 characters)
        <input name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      <label>
        New password again
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
    </form>
  );
}
