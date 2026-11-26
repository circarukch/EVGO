import { notFound } from "next/navigation";
import { adminFetch } from "../../../lib/api";
import { ChargerProduct } from "../../../lib/shop";
import { ProductForm } from "../product-form";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await adminFetch(`/admin/shop/products/${encodeURIComponent(id)}`);
  if (res.status === 404) notFound();
  if (!res.ok) return <p className="error">Could not reach the EVGO API.</p>;
  const product: ChargerProduct = await res.json();
  return (
    <main>
      <p><a href="/shop">← Charger shop</a></p>
      <h1>Edit {product.name}</h1>
      <ProductForm product={product} />
    </main>
  );
}
