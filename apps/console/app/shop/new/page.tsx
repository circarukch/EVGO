import { ProductForm } from "../product-form";

export default function NewProductPage() {
  return (
    <main>
      <p><a href="/shop">← Charger shop</a></p>
      <h1>Add a charger for sale</h1>
      <ProductForm />
    </main>
  );
}
