import { adminFetch, Station } from "../../lib/api";

export const dynamic = "force-dynamic";

async function load(): Promise<Station[] | null> {
  try {
    const res = await adminFetch("/admin/stations");
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export default async function StationsPage() {
  const stations = await load();
  if (stations === null) return <p className="error">Could not reach the EVGO API.</p>;
  const chargers = stations.flatMap((s) => s.chargers);
  const online = chargers.filter((c) => c.online).length;
  return (
    <main>
      <div className="head">
        <h1>Stations</h1>
        <a className="button" href="/stations/new">Add station</a>
      </div>
      <p>
        {stations.length} stations, {chargers.length} chargers, {online} online now
      </p>
      <table className="wide">
        <thead>
          <tr>
            <th align="left">Station</th>
            <th align="left">Operator</th>
            <th align="left">Chargers</th>
            <th align="left">Plugs</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((s) => (
            <tr key={s.id}>
              <td>
                <a href={`/stations/${s.id}`}><b>{s.name}</b></a>
                <div className="hint">{s.city}{s.access === "fleet_only" && " · fleet only"}</div>
              </td>
              <td>{s.operator.name}</td>
              <td>
                {s.chargers.length === 0 && <span className="hint">None yet</span>}
                {s.chargers.map((c) => (
                  <div key={c.chargePointId}>
                    <span className={`dot ${c.online ? "on" : "off"}`} aria-hidden /> {c.chargePointId}
                  </div>
                ))}
              </td>
              <td>
                {s.chargers.flatMap((c) => c.connectors).map((k, i) => (
                  <span key={i} className="plug">{k.label} {k.powerKw} kW</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
