// Operator console home: charger status board. Bus ops and admin pages follow in Phase 1.
const API = process.env.EVGO_API_URL ?? "http://localhost:3001/v1";

type Charger = {
  id: string;
  operator: string;
  place?: { name: string };
  connectors: { id: number; type: string; powerKw: number; status: string }[];
};

async function loadChargers(): Promise<Charger[] | null> {
  try {
    const res = await fetch(`${API}/chargers`, { cache: "no-store" });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export default async function ChargersBoard({ searchParams }: { searchParams: Promise<{ denied?: string; password?: string }> }) {
  const { denied, password } = await searchParams;
  const chargers = await loadChargers();
  if (chargers === null) return <p>API unreachable at {API}.</p>;
  const connectors = chargers.flatMap((c) => c.connectors);
  const faulted = connectors.filter((k) => k.status === "Faulted").length;
  return (
    <main>
      {denied && <p className="secret">That page is for EVGO admins only.</p>}
      {password && <p className="notice">Password saved.</p>}
      <h1>Chargers</h1>
      <p>
        {chargers.length} public chargers, {connectors.length} connectors, {faulted} faulted
      </p>
      <table cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Charger</th>
            <th align="left">Site</th>
            <th align="left">Operator</th>
            <th align="left">Connectors</th>
          </tr>
        </thead>
        <tbody>
          {chargers.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid #eee" }}>
              <td>{c.id}</td>
              <td>{c.place?.name}</td>
              <td>{c.operator}</td>
              <td>{c.connectors.map((k) => (<span key={k.id} className={`status-${k.status}`}>{k.type} {k.powerKw} kW: {k.status}{" "}</span>))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
