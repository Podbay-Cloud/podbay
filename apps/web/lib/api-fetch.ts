/**
 * Client-side JSON GET for the cockpit's polled reads.
 *
 * WHY this exists: cockpit reads used to be Next.js SERVER ACTIONS, which the App Router runs
 * strictly one-at-a-time per client. The always-on 10s live-signals poll could hang on a wedged pod
 * and monopolize that single lane, starving the secrets/stats/control reads — they sat in skeleton
 * "forever" until a refresh reset the client's action queue. Route Handlers (GET /api/…) are plain
 * HTTP, so `fetch`es run in PARALLEL — a slow poll can't block the others. `useQuery` over `fetch`
 * is the parallel transport; `useQuery` over a server action is not (see docs/plans, the Aug-2026
 * server-action-serialization fix).
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    let msg = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") msg = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}
