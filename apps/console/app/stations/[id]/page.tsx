import { notFound } from "next/navigation";
import { adminFetch, Station } from "../../../lib/api";
import { MapPreview } from "../map-preview";
import { AddChargerForm } from "./add-charger-form";
import { AutoRefresh } from "./auto-refresh";
import { ChargerCard } from "./charger-card";

export const dynamic = "force-dynamic";

export default async function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await adminFetch(`/admin/stations/${encodeURIComponent(id)}`).catch(() => null);
  if (!res) return <p className="error">Could not reach the EVGO API.</p>;
  if (res.status === 404) notFound();
  const s: Station = await res.json();
  return (
    <main>
      <AutoRefresh seconds={5} />
      <p className="hint"><a href="/stations">Stations</a> /</p>
      <h1>
        {s.name} <span className="tag">{s.operator.name}</span>
      </h1>
      <p>
        {s.city} · {s.lat.toFixed(5)}, {s.lng.toFixed(5)} · {s.access === "fleet_only" ? "Fleet only" : "Shown in the app"}
      </p>
      <MapPreview lat={s.lat} lng={s.lng} height={180} />

      <h2>Chargers</h2>
      {s.chargers.length === 0 && <p className="hint">No chargers yet. Add the first one below.</p>}
      {s.chargers.map((c) => (
        <ChargerCard key={c.chargePointId} siteId={s.id} charger={c} />
      ))}

      <AddChargerForm siteId={s.id} />
    </main>
  );
}
