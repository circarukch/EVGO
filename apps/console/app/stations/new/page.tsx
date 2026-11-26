import { adminFetch } from "../../../lib/api";
import { StationForm } from "./station-form";

export const dynamic = "force-dynamic";

export default async function NewStationPage() {
  const res = await adminFetch("/admin/cpo-operators").catch(() => null);
  const operators: { id: string; name: string }[] = res?.ok ? await res.json() : [];
  return (
    <main>
      <p className="hint"><a href="/stations">Stations</a> /</p>
      <h1>Add station</h1>
      <StationForm operators={operators} />
    </main>
  );
}
