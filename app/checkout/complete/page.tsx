export default async function CheckoutCompletePage({
  searchParams
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const status = resolvedSearchParams?.status ?? "pending";
  const isFailed = status === "failed";

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card">
        <div className="auth-form-header">
          <span className="badge auth-badge">{isFailed ? "Payment error" : "Payment incomplete"}</span>
          <h2>{isFailed ? "We could not confirm this checkout." : "Your workspace is not active yet."}</h2>
          <p className="muted">
            {isFailed
              ? "The Billplz return could not be verified. Try the payment again or ask the platform owner to review the Billplz keys."
              : "Billplz has not confirmed a paid checkout on this return yet. Complete payment first, then come back to activate the workspace login."}
          </p>
        </div>

        <div className="auth-footer">
          <a className="muted" href="/packages">
            Choose package again
          </a>
          <a className="muted" href="/login">
            Go to login
          </a>
        </div>
      </section>
    </main>
  );
}
