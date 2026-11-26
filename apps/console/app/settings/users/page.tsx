import { adminFetch } from "../../../lib/api";
import { currentUser, ROLE_LABEL } from "../../../lib/session";
import { AddUserForm, UserActions } from "./user-forms";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "station_operator";
  orgName: string | null;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never";

export default async function UsersPage() {
  const me = await currentUser();
  const res = await adminFetch("/admin/console-users");
  if (!res.ok) return <p className="error">Could not reach the EVGO API.</p>;
  const users: Row[] = await res.json();
  const orgsRes = await adminFetch("/admin/cpo-operators");
  const orgs: { id: string; name: string }[] = orgsRes.ok ? await orgsRes.json() : [];
  return (
    <main>
      <h1>Console users</h1>
      <p>
        People who can sign in here. <b>Admins</b> can do everything. <b>Station operators</b> see and manage only their own company&apos;s stations
        and chargers.
      </p>
      <table className="wide">
        <thead>
          <tr>
            <th align="left">Person</th>
            <th align="left">Role</th>
            <th align="left">Last sign-in</th>
            <th align="left" />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.active ? "" : "off"}>
              <td>
                <b>{u.name}</b>
                {!u.active && <span className="tag">Switched off</span>}
                {u.active && u.mustChangePassword && <span className="tag">Temporary password</span>}
                <div className="hint">{u.email}</div>
              </td>
              <td>
                {ROLE_LABEL[u.role] ?? u.role}
                {u.role === "station_operator" && <div className="hint">{u.orgName}</div>}
              </td>
              <td className="hint">{when(u.lastLoginAt)}</td>
              <td className="actions">
                <UserActions id={u.id} active={u.active} self={u.id === me?.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddUserForm orgs={orgs} />
    </main>
  );
}
