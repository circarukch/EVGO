"use client";

import { useActionState, useState } from "react";
import { addUser, RowState, userAction, UserFormState } from "./actions";

function TempPassword({ email, password }: { email: string; password: string }) {
  return (
    <div className="secret">
      <p>
        Give <b>{email}</b> this temporary password. It is shown only now. They choose their own at first sign-in.
      </p>
      <code>{password}</code>
    </div>
  );
}

export function AddUserForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, submit, busy] = useActionState<UserFormState, FormData>(addUser, {});
  const [role, setRole] = useState("station_operator");
  return (
    <form action={submit} className="card form">
      <h2>Add a console user</h2>
      <div className="row">
        <label>
          Name
          <input name="name" required placeholder="Ravi Kumar" />
        </label>
        <label>
          Email
          <input name="email" type="email" required placeholder="ravi@suncharge.in" />
        </label>
      </div>
      <div className="row">
        <label>
          Role
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="station_operator">Station operator: only their own stations and chargers</option>
            <option value="admin">Admin: everything, including users and settings</option>
          </select>
        </label>
        {role === "station_operator" && (
          <label>
            Works for
            <select name="orgId" required defaultValue="">
              <option value="" disabled>Choose the charging operator</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {state.created && <TempPassword email={state.created.email} password={state.created.temporaryPassword} />}
      <button type="submit" disabled={busy}>{busy ? "Adding…" : "Add user"}</button>
    </form>
  );
}

export function UserActions({ id, active, self }: { id: string; active: boolean; self: boolean }) {
  const [state, submit, busy] = useActionState<RowState, FormData>(userAction, {});
  return (
    <>
      <form action={submit} className="inline">
        <input type="hidden" name="id" value={id} />
        <button type="submit" name="what" value="reset" className="small secondary" disabled={busy}>Reset password</button>
        {!self && (
          <button type="submit" name="what" value={active ? "off" : "on"} className={`small ${active ? "danger" : "secondary"}`} disabled={busy}>
            {active ? "Switch off" : "Switch on"}
          </button>
        )}
      </form>
      {state.error && <p className="error">{state.error}</p>}
      {state.reset && <TempPassword email={state.reset.email} password={state.reset.temporaryPassword} />}
    </>
  );
}
