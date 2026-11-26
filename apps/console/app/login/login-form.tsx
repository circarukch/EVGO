"use client";

import { useActionState } from "react";
import { LoginState, signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, submit, busy] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={submit} className="card form login">
      <input type="hidden" name="next" value={next} />
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required defaultValue={state.email} autoFocus />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
