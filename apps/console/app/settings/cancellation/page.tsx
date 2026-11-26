import { adminFetch, Operator, orNull } from "../../../lib/api";
import { PolicyForm } from "./policy-form";

export const dynamic = "force-dynamic";

export default async function CancellationSettings() {
  let operators: Operator[] | null = null;
  const problem = "Could not reach the EVGO API.";
  try {
    const res = await adminFetch("/admin/operators");
    if (res.ok) operators = await res.json();
  } catch (e) {
    orNull(e);
  }
  return (
    <main>
      <h1>Cancellation and refunds</h1>
      <p>Each bus operator sets how much of the fare goes back to the customer&apos;s wallet when they cancel.</p>
      {operators === null ? <p className="error">{problem}</p> : operators.map((o) => <PolicyForm key={o.id} operator={o} />)}
    </main>
  );
}
