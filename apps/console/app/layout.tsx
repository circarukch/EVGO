import type { ReactNode } from "react";
import { signOut } from "./login/actions";
import { currentUser, ROLE_LABEL } from "../lib/session";
import "./globals.css";

export const metadata = { title: "EVGO Operator console" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const me = await currentUser();
  if (!me) {
    // Sign-in page (or an expired session on its way there): no menu.
    return (
      <html lang="en">
        <body className="bare">{children}</body>
      </html>
    );
  }
  const admin = me.role === "admin";
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/evgo-logo.png" alt="EVGO" width={120} height={34} />
          </a>
          <p className="sub">Operator console</p>
          <ul>
            <li><a href="/">Chargers</a></li>
            <li><a href="/stations">Stations</a></li>
            {admin && (
              <>
                <li>Sessions</li>
                <li>Tariffs</li>
                <li>Routes and trips</li>
                <li>Manifests</li>
                <li><a href="/settings/cancellation">Cancellation and refunds</a></li>
                <li>Settlements</li>
                <li><a href="/shop">Charger shop</a></li>
                <li><a href="/shop/leads">Shop enquiries</a></li>
                <li><a href="/settings/users">Console users</a></li>
              </>
            )}
          </ul>
          <div className="me">
            <b>{me.name || me.email}</b>
            <div className="hint">
              {ROLE_LABEL[me.role]}
              {me.role === "station_operator" && me.orgName ? ` · ${me.orgName}` : ""}
            </div>
            <a href="/account/password">Change password</a>
            <form action={signOut}>
              <button type="submit" className="link">Sign out</button>
            </form>
          </div>
        </nav>
        <div className="content">{children}</div>
      </body>
    </html>
  );
}
