"use client";

type QuickRepliesErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function QuickRepliesError({ error, reset }: QuickRepliesErrorProps) {
  return (
    <main className="app-main">
      <div className="more-page-stack">
        <section className="auth-page-hero auth-page-hero-compact">
          <div className="auth-page-hero-copy">
            <span className="auth-page-kicker">Quick replies</span>
            <h2>Quick Reply Library</h2>
            <p>The quick reply module could not be loaded. Retry after reviewing the error below.</p>
          </div>
        </section>
        <section className="content-card quick-replies-list-empty">
          <strong>Unable to load quick replies</strong>
          <span>{error.message || "An unexpected quick reply error occurred."}</span>
          <div className="campaigns-list-empty-actions">
            <a className="button button-ghost" href="/quick-replies">
              Back to quick replies
            </a>
            <button className="button button-secondary" onClick={reset} type="button">
              Try again
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
