import { redirect } from "next/navigation";
import { currentUser } from "../../../lib/session";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  return (
    <main>
      <h1>{me.mustChangePassword ? "Choose your password" : "Change password"}</h1>
      {me.mustChangePassword && <p>You signed in with a temporary password. Choose your own before using the console.</p>}
      <p className="hint">Changing it signs you out everywhere else.</p>
      <PasswordForm first={me.mustChangePassword} />
    </main>
  );
}
