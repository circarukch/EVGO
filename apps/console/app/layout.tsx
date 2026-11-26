import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "EVGO Operator console" };

export default function RootLayout({ children }: { children: ReactNode }) {
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
            <li>Sessions</li>
            <li>Tariffs</li>
            <li>Routes and trips</li>
            <li>Manifests</li>
            <li><a href="/settings/cancellation">Cancellation and refunds</a></li>
            <li>Settlements</li>
            <li><a href="/shop">Charger shop</a></li>
            <li><a href="/shop/leads">Shop enquiries</a></li>
          </ul>
        </nav>
        <div className="content">{children}</div>
      </body>
    </html>
  );
}
