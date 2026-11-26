// Customer website. Route pages ("Guntur to Hyderabad bus") are server-rendered for search ranking.
const API = process.env.EVGO_API_URL ?? "http://localhost:3001/v1";

type Trip = { id: string; operator: string; departs: string; arrives: string; busType: string; seatsLeft: number; fareInr: number; chargersAtBoarding: number };

async function loadTrips(): Promise<Trip[] | null> {
  try {
    const res = await fetch(`${API}/trips?from=Guntur&to=Hyderabad`, { cache: "no-store" });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const trips = await loadTrips();
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>EVGO</h1>
      <p>Electric buses and EV charging, one app, one wallet.</p>
      <h2>Guntur to Hyderabad</h2>
      {trips === null ? (
        <p>Trip search is unavailable. Start the API with <code>pnpm --filter @evgo/api dev</code>.</p>
      ) : (
        <ul>
          {trips.map((t) => (
            <li key={t.id}>
              {t.departs} to {t.arrives}, {t.busType}, {t.operator}: ₹{t.fareInr}, {t.seatsLeft} seats left
              {t.chargersAtBoarding > 0 ? `, ${t.chargersAtBoarding} chargers at boarding` : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
