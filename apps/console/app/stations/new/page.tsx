import { adminFetch, orNull } from "../../../lib/api";
import { currentUser } from "../../../lib/session";
import { StationForm } from "./station-form";

export const dynamic = "force-dynamic";

export default async function NewStationPage() {
  const res = await adminFetch("/admin/cpo-operators").catch(orNull);
  const operators: { id: string; name: string }[] = res?.ok ? await res.json() : [];
  const me = await currentUser();
  return (
    <main>
      <p className="hint"><a href="/stations">Stations</a> /</p>
      <h1>Add station</h1>
      <StationForm operators={operators} canAddOperator={me?.role === "admin"} />
    </main>
  );
}
