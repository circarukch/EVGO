import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "EVGO: electric bus tickets and EV charging",
  description: "Book electric bus seats and charge your EV in one app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <div className="bar">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/evgo-logo.png" alt="EVGO" width={126} height={36} />
            <span>Bus tickets and EV charging</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
