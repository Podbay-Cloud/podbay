"use client";

/** Pod workspace error boundary: same branding, points back at the dashboard. */
export default function PodError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="shell">
      <div className="card auth">
        <h1>Couldn&apos;t open this pod</h1>
        <p className="muted">
          The workspace hit an unexpected error. It may be waking up — try again in a moment.
        </p>
        {error.digest && (
          <p className="muted" style={{ fontFamily: "ui-monospace, monospace" }}>
            error code: {error.digest}
          </p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="gh" onClick={() => reset()}>
            Try again
          </button>
          <a className="pill" href="/dashboard">
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
