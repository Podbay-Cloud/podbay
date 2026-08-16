"use client";

/**
 * Branded global error boundary — replaces Next's default
 * "Application error occurred" with a retry and a reportable digest.
 *
 * Special-cases DEPLOY SKEW: after a deploy, a tab loaded from the old build sends
 * a stale server-action id, which the new server rejects ("Server Action … was not
 * found"). Next's soft reset() keeps the stale JS, so it'd fail again — only a FULL
 * reload pulls a fresh bundle. Detect that case and offer Reload, with a message
 * that says what actually happened instead of a scary generic error.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const deploySkew = /server action|failed to find|was not found|deployment/i.test(
    error?.message ?? "",
  );

  return (
    <main className="shell">
      <div className="card auth">
        <span className="logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-mark" src="/podbay-mark.svg" alt="Podbay" />
          <span className="wordmark">
            <span className="pod">pod</span>
            <span className="bay">bay</span>
          </span>
        </span>
        {deploySkew ? (
          <>
            <h1>Podbay was updated</h1>
            <p className="muted">
              A new version was deployed while this page was open, so that action expired. Reload to
              pick up the latest and continue — nothing was lost.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="gh" onClick={() => window.location.reload()}>
                Reload
              </button>
              <a className="pill" href="/dashboard">
                Back to dashboard
              </a>
            </div>
          </>
        ) : (
          <>
            <h1>Something went wrong</h1>
            <p className="muted">
              An unexpected error occurred. You can try again — if it keeps happening, tell us and
              include the code below.
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
              <button className="gh" onClick={() => window.location.reload()}>
                Reload page
              </button>
              <a className="pill" href="/dashboard">
                Back to dashboard
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
