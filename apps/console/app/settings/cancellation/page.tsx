import { adminFetch, Operator } from "../../../lib/api";
import { PolicyForm } from "./policy-form";

export const dynamic = "force-dynamic";

export default async function CancellationSettings() {
  let operators: Operator[] | null = null;
  let problem = "Could not reach the EVGO API.";
  try {
    const res = await adminFetch("/admin/operators");
    if (res.ok) operators = await res.json();
    else if (res.status === 401) problem = "The console's admin key was refused by the API. Check EVGO_ADMIN_API_KEY.";
  } catch (e) {
    if (e instanceof Error && e.message.includes("EVGO_ADMIN_API_KEY")) problem = e.message;
  }
  return (
    <main>
      <h1>Cancellation and refunds</h1>
      <p>Each bus operator sets how much of the fare goes back to the customer&apos;s wallet when they cancel.</p>
      {operators === null ? <p className="error">{problem}</p> : operators.map((o) => <PolicyForm key={o.id} operator={o} />)}
    </main>
  );
}
