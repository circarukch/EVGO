import type { ReactNode } from "react";

export const metadata = {
  title: "EVGO: bus tickets and EV charging",
  description: "Book electric bus seats and charge your EV in one app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
