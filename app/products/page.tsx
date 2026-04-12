import { DashboardShell } from "@/components/dashboard-shell";
import { ProductCatalogPanel } from "@/components/product-catalog-panel";
import { listProducts } from "@/lib/products";

export default async function ProductsPage() {
  const products = await listProducts();

  return (
    <DashboardShell currentPath="/products">
      <section className="hero">
        <div>
          <span className="badge">Property Catalog</span>
          <h2>Define property listings once, reuse them across leads.</h2>
          <p className="muted">
            Configure property listings here, then tag conversations to those catalog entries in
            the inbox.
          </p>
        </div>
      </section>

      <ProductCatalogPanel products={products} />
    </DashboardShell>
  );
}
