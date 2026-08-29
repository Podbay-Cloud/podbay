## Context

From the audit (file:line). Stack: **Next 15 App Router + React 19** → `@tanstack/react-query` v5 with
the modern hydration API (`HydrationBoundary` + `dehydrate`). No react-query today; no shared fetch
hook; no cache; no skeleton primitive.

- **Provider:** `app/layout.tsx` and `app/dashboard/layout.tsx` are **server** components; `{children}`
  is rendered directly with **no client provider wrapper**. A new `"use client"` provider must be
  introduced.
- **Static data is already SSR'd.** The dashboard server-fetches the pod list (`getPodService()
  .listPods`, `dashboard/page.tsx:36`) and the cockpit server-fetches a big bundle (pod, env, usage,
  adminActions, relay, activity, images) into `<PodCockpit>` props. Those don't jump.
- **LIVE data is client-fetched on mount** — the jump + stuck source: dashboard live-signals
  (`getOwnerLiveSignals` polled in `pod-card-list.tsx`), cockpit agent states (`getAgentStates` in
  `agent-cards.tsx`), metrics (`getPodMetrics`), secrets (`listPodSecrets`), doctor, github.
- **Deliberate anti-block:** `dashboard/page.tsx:38-40` states live-signals are client-fetched *on
  purpose* — "so a dashboard navigation renders instantly instead of blocking on an N-pod /healthz
  sweep first." Any SSR-prefetch design MUST NOT undo that.
- **Actions ARE server-callable.** `lib/actions.ts` is `"use server"` but those compile to plain async
  functions callable during SSR (the cockpit already awaits `myRelayLive`/`getPodActivity` in render).
  For prefetch, call the underlying `getPodService().*` directly (server-only, already used for
  `listPods`); the CLIENT keeps calling the `"use server"` actions as its query `fetcher`.
- **SSR-seed template:** `RelayStatus({ initial })` + `ActivityTab({ initialEvents })` already do
  "server-seed a prop → `useState(initial)` → poll" — the exact thing react-query hydration replaces.
- **Skeletons:** none exist; only tiny `animate-pulse` accents. Full-panel `Loader2`/"Loading…"
  placeholders in secrets-panel, agent-cards, health-panel, github-wizard, diagnostics-panel.

## Goals / Non-Goals

**Goals:**
- One data primitive (react-query) for every client fetch: cache + stale-while-revalidate + bounded
  retry + `refetchInterval` polling + `useMutation` + invalidation.
- **Snappy:** re-opening a pod / cockpit / tab renders instantly from cache (no jump); first-ever load
  shows a skeleton, not blank/spinner.
- **Near-realtime, never silently stale:** cache paints instantly THEN refetches immediately (stale
  window ~1s), plus the poll — the displayed state is current, never minute-old.
- **Never stuck:** react-query's retry + error state replaces the no-`.catch` hang everywhere.
- Remove the interim `lib/use-live-data.ts`.

**Non-Goals:**
- Do NOT block the dashboard shell on a live N-pod healthz sweep (preserve the deliberate design).
- No server behavior / schema / edition change — this is the client data layer + hydration.
- Not migrating fetches that are already SSR-prop-seeded and fine (relay, activity) unless it reduces
  code — they can move to react-query opportunistically, not as a requirement.

## Decisions

**D1 — `QueryClientProvider` in a new `"use client"` providers wrapper, scoped to the dashboard.**
Add `app/providers.tsx` (`"use client"`, `QueryClientProvider` with a module-singleton browser
`QueryClient`, SSR-safe per React docs) and wrap in `app/dashboard/layout.tsx` (the data-heavy area) —
not sitewide, so marketing/landing pages stay provider-free. Defaults: `staleTime` ~5s (so a
re-navigation within 5s doesn't even refetch — instant), `gcTime` a few minutes, `retry: 2`,
`refetchOnWindowFocus: true` (cheap near-realtime nudge).

**D2 — react-query for ALL the client fetches; polling via `refetchInterval`.**
Migrate: agent states (`refetchInterval` 10s, 2s while signing in), owner live-signals (3s/10s), metrics
(30s), secrets (no poll), doctor (button + on-mount), github status/repos, term-stats, diagnostics,
pod-card live signals. Each becomes a `useQuery({ queryKey, queryFn: () => <the "use server" action>,
refetchInterval, staleTime })`. Writes become `useMutation` + `queryClient.invalidateQueries` (secret
save/delete, codex RC toggle). A shared `lib/query-keys.ts` centralizes the keys.

**D3 — "never clobber / accept-empty" via `select` + `placeholderData`.**
The server SWALLOWS fetch errors into `[]` (e.g. `podHealth.catch(() => [])`), so an empty result is
ambiguous (blip vs old-image). Use `placeholderData: keepPreviousData` so a transient empty/refetch
never blanks the screen, and treat `[]` as a valid terminal answer (old image) — react-query's retry
covers the true-failure (reject/timeout) path. This reproduces the useLiveData semantics with the
library.

**D4 — CLIENT-ONLY react-query + skeletons; NO SSR prefetch (owner decision: keep the code simple).**
SSR-prefetching LIVE data means the server awaits a healthz call before first paint — the exact block
the dashboard deliberately avoids — and the `dehydrate`/`HydrationBoundary`/streaming wiring adds real
complexity. So drop it. All live fetches are CLIENT-side react-query:
- The **already-SSR'd static data** (pod list, cockpit bundle) still renders server-side with no jump —
  that's unchanged and free.
- The **live layer** (agent state, live signals, metrics, secrets) is fetched client-side via
  `useQuery`. FIRST-ever load shows a **skeleton** (not blank/spinner). Every SUBSEQUENT navigation
  (tab switch, re-open) renders **instantly from the react-query cache**, then background-refreshes.
- Net trade-off (accepted): a brief skeleton on a genuine cold load / hard reload, in exchange for a
  much simpler client-only data layer. Snappy re-navigation + near-realtime + never-stuck are all still
  delivered by the cache + poll + retry.

**D5 — A real `Skeleton` primitive + per-surface skeletons.**
Add `components/ui/skeleton.tsx` (shadcn: `rounded-md bg-muted animate-pulse`). Replace the full-panel
`Loader2`/"Loading…" placeholders (secrets, agent cards, health-panel, github-wizard, the pod-card live
chip) with skeletons that mirror the content shape. `react-query`'s `isPending && !isPlaceholderData`
gates the skeleton.

**D6 — Remove `lib/use-live-data.ts`** and its `agent-cards` usage — react-query subsumes it.

## Risks / Trade-offs

- **[Provider/SSR singleton pitfalls]** → follow the official React-19 pattern (a `getQueryClient()`
  that makes a fresh client on the server per request and a singleton in the browser) — the classic
  react-query Next gotcha; cite the docs in the task.
- **[`refetchInterval` running for hidden tabs]** → react-query pauses interval refetch for
  `document.hidden` by default (`refetchIntervalInBackground: false`), which also fixes the
  "always-poll" cost — better than the hand-rolled polls.
- **[Stale-while-revalidate showing old data]** → bounded to the ~1s refetch; the poll + focus-refetch
  keep it current. Meets "near-realtime, never silently minute-old." If a surface is safety-sensitive,
  gate its skeleton on `isStale` instead of showing cached.
- **[Migration surface is broad]** → do it incrementally (Control + Secrets + dashboard first — the
  reported pain — then the rest), each independently shippable; the provider + query-keys land first.
- **[Edition parity]** → same web app both editions; nothing edition-specific here. Verify a self-host
  build still boots with the provider.

## Migration Plan

Provider + query-keys + Skeleton primitive first (no behavior change). Then migrate surface-by-surface
(each a shippable commit): Control (agent-cards), Secrets, dashboard cards, Stats, health-panel,
github, term-stats, diagnostics. Remove `use-live-data.ts` once agent-cards is migrated. Verify: build
green; a real-pod click-through of each tab (no stuck, no jump, tab-switch instant); a hard reload
shows skeleton→data (not blank); self-host build boots.

## Open Questions

- **`staleTime` value** — 5s keeps re-nav instant without feeling stale; confirm against the
  "near-realtime" bar (lower it if any surface must be fresher).
- **Provider scope** — dashboard-layout only (proposed) vs sitewide; dashboard-only keeps landing lean.

*(Resolved: NO SSR prefetch — client-only + skeletons, owner decision to keep the code simple.)*
