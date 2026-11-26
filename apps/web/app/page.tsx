// Customer website. Route pages ("Guntur to Hyderabad bus") are server-rendered for search ranking.
const API = process.env.EVGO_API_URL ?? "http://localhost:3001/v1";

type Trip = {
  id: string;
  operator: string;
  departs: string;
  arrives: string;
  departsAt: string;
  busType: string;
  seatsLeft: number;
  fareInr: number;
  chargersAtBoarding: number;
};

async function loadTrips(): Promise<Trip[] | null> {
  try {
    const res = await fetch(`${API}/trips?from=Guntur&to=Hyderabad`, { cache: "no-store" });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export default async function Home() {
  const trips = await loadTrips();
  return (
    <main>
      <h1>Guntur to Hyderabad by electric bus</h1>
      <p className="lead">Book your seat, and charge your EV at the boarding point while you travel. One app, one wallet.</p>
      {trips === null ? (
        <p>Trip search is unavailable right now.</p>
      ) : (
        <ul className="trips">
          {trips.slice(0, 12).map((t) => (
            <li key={t.id}>
              <div>
                <div className="time">
                  {day(t.departsAt)}, {t.departs} to {t.arrives}
                </div>
                <div className="meta">
                  {t.busType} · {t.operator} · {t.seatsLeft} seats left
                  {t.chargersAtBoarding > 0 && <span className="charge"> · {t.chargersAtBoarding} chargers at boarding</span>}
                </div>
              </div>
              <div className="fare">₹{t.fareInr}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
