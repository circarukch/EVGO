import type { ReactNode } from "react";

export const metadata = { title: "EVGO Operator console" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, display: "flex", minHeight: "100vh" }}>
        <nav style={{ width: 200, padding: 16, borderRight: "1px solid #ddd" }}>
          <strong>EVGO Operator</strong>
          <ul style={{ listStyle: "none", padding: 0, lineHeight: 2 }}>
            <li>Chargers</li>
            <li>Sessions</li>
            <li>Tariffs</li>
            <li>Routes and trips</li>
            <li>Manifests</li>
            <li>Settlements</li>
          </ul>
        </nav>
        <div style={{ flex: 1, padding: 24 }}>{children}</div>
      </body>
    </html>
  );
}
