## Why

The web app has no data-fetching layer — every component hand-rolls `useEffect` + `useState(null)` +
a bare `.then()`. A 2026-08-23 audit found **9 stuck-loading-prone fetches** and no shared hook, cache,
or query library. The consequences the owner hit, in one week:

- **Stuck loading.** A fetch that rejects with no `.catch` never clears the loading flag —
  `secrets-panel` "Loading…", `health-panel` "Checking…", `github-wizard` "Loading repositories…" all
  hang forever on a transient error.
- **"Status unavailable" after a tab switch.** `agent-cards` clobbers its live state with an empty
  result on a blip, so the Control tab reads "unknown" after navigating away and back.
- **Jumpy, un-snappy render.** The page renders empty → the fetch resolves → it re-renders (the
  "jump") — and because Radix Tabs **unmounts inactive `TabsContent`**, every cockpit tab (Control,
  Secrets, Stats, Activity, Admin) cold-remounts and **re-fetches on every switch**. Opening the pod
  list or a cockpit re-fetches everything while it renders.

These are one root cause — fetch-on-mount with no cache, retry, or error handling — and the right fix
is the industry-standard tool, not another hand-rolled hook. **TanStack Query (react-query)** gives
caching + stale-while-revalidate (snappy re-navigation, no jump), `refetchInterval` polling
(near-realtime, never minute-old), and built-in bounded retry + error states (no stuck) — CLIENT-only,
with **skeletons** for the brief first-ever load (owner decision: no SSR prefetch, to keep the code
simple). Already-server-rendered static data (pod list, cockpit bundle) is unchanged and doesn't jump.

## What Changes

- **Add `@tanstack/react-query`** with a `QueryClientProvider` at the app root (a client providers
  wrapper), sensible defaults (bounded retry, a `staleTime` that keeps re-navigation instant while a
  background refetch keeps data current).
- **Migrate the fetch sites to `useQuery`** with `refetchInterval` for the live ones (agent states,
  metrics, owner live-signals) and `staleTime` + cache so re-opening a pod / cockpit / tab renders
  **instantly from cache**, then background-refreshes — snappy AND near-realtime, never silently stale.
- **`useMutation` + query invalidation** for writes (secret save/delete, codex RC toggle, etc.), so the
  UI reflects a change without a hand-rolled re-fetch.
- **Skeleton loading states** (owner's ask): a shared `Skeleton` component replaces the "Loading…" /
  full-panel spinner placeholders for the brief load / streaming windows (pod cards, cockpit tabs).
- **Remove the interim hand-rolled hook** `apps/web/lib/use-live-data.ts` (and its partial application
  in `agent-cards`) — react-query supersedes it.

**Non-negotiable (owner):** the displayed state stays **near-realtime** — poll + cache-then-refresh —
and is **never shown as fresh while silently minute-old**. The cache is stale-while-revalidate: it
paints the last-known value instantly and refetches immediately, so the stale window is ~1s, then live.

## Capabilities

### New Capabilities
<!-- none — this is an implementation/architecture change; behavior (near-realtime, no-stuck, snappy) is
     spec'd under the existing dashboard capability. -->

### Modified Capabilities
- `dashboard`: the cockpit and pod list present **near-realtime** data that renders **immediately**
  (cached/prefetched, no jump), refreshes in the background, and **never gets stuck** on a loading
  state when a fetch fails — with skeletons, not blank/​spinner placeholders, during the brief load.

## Impact

- **New dep:** `@tanstack/react-query` (v5).
- **New:** `apps/web/app/providers.tsx` (`"use client"` `QueryClientProvider`), wrapped in
  `app/dashboard/layout.tsx`; `lib/query-keys.ts`; `components/ui/skeleton.tsx` + per-surface skeletons.
- **Query/mutation migration (client-only):** `secrets-panel`, `agent-cards`, `pod-stats`,
  `health-panel`, `github-wizard`/`github-connect`, `pod-cockpit` (live signals + update/T3 progress
  polls), `term-stats`, `diagnostics-panel`, `pod-card-list` (owner live signals).
- **Removed:** `apps/web/lib/use-live-data.ts`.
- **No SSR prefetch** (dropped for simplicity); no server pages change beyond wrapping the provider.
- **Edition-agnostic** (both cloud + self-host serve the same web app); no schema, no server behavior
  change — this is the client data layer + SSR hydration.
