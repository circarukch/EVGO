import { adminFetch, orNull } from "../../lib/api";
import { ChargerProduct, inr } from "../../lib/shop";

export const dynamic = "force-dynamic";

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const res = await adminFetch("/admin/shop/products").catch(orNull);
  if (!res?.ok) return <p className="error">Could not reach the EVGO API.</p>;
  const products: ChargerProduct[] = await res.json();
  const samples = products.filter((p) => p.isSample).length;
  return (
    <main>
      <div className="head">
        <h1>Charger shop</h1>
        <div>
          <a className="button secondary" href="/shop/leads">Enquiries</a> <a className="button" href="/shop/new">Add product</a>
        </div>
      </div>
      <p>
        Chargers customers see under <b>Want a charger?</b> in the app. Customers ask for a quote; there is no online payment.
      </p>
      {saved && <p className="ok">Saved.</p>}
      {samples > 0 && (
        <p className="secret">
          {samples} of {products.length} products are <b>samples</b> with placeholder prices. Edit them with real models and prices, or untick
          &quot;Show in the app&quot; to hide them.
        </p>
      )}
      <table className="wide">
        <thead>
          <tr>
            <th align="left">Product</th>
            <th align="left">Type</th>
            <th align="left">Connectors</th>
            <th align="left">Price</th>
            <th align="left">In app</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>
                <b>{p.name}</b>
                {p.isSample && <span className="tag">Sample</span>}
                <div className="hint">{p.brand}</div>
              </td>
              <td>
                {p.current} {p.powerKw} kW
              </td>
              <td>
                {p.connectors.map((c, i) => (
                  <span key={i} className="plug">{c}</span>
                ))}
              </td>
              <td>{p.priceInr === null ? <span className="hint">On quote</span> : inr(p.priceInr)}</td>
              <td>{p.active ? "Shown" : <span className="hint">Hidden</span>}</td>
              <td className="actions">
                <a className="button small secondary" href={`/shop/${p.id}`}>Edit</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
