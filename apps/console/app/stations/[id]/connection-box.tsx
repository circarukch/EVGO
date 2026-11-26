"use client";

import { useState } from "react";
import type { Connection } from "../../../lib/stations";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** The login the installer enters in the charger. Shown once: EVGO keeps only a scrambled copy of the password. */
export function ConnectionBox({ c }: { c: Connection }) {
  const rows: [string, string][] = [
    ["Central system URL", c.url],
    ["Charge point ID (username)", c.username],
    ["Password", c.password],
    ["Protocol", `OCPP ${c.ocppVersion}, security profile ${c.securityProfile} (Basic auth${c.securityProfile === 2 ? " over TLS" : ""})`],
  ];
  return (
    <div className="secret">
      <p>
        <b>Copy the password now.</b> It is not shown again. If it is lost, make a new one.
      </p>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th align="left">{k}</th>
              <td><code>{v}</code></td>
              <td>{k !== "Protocol" && <Copy text={v} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
