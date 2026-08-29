# Tasks

Foundation first (provider + keys + skeleton), then migrate surface-by-surface (each independently
shippable), then remove the interim hook. Verify on a real pod per tab.

## 1. Foundation — provider, client, keys, skeleton

- [x] 1.1 Add `@tanstack/react-query` (v5) to `apps/web` (`pnpm --filter @podbay/web add @tanstack/react-query`).
- [x] 1.2 `app/providers.tsx` (`"use client"`): a `getQueryClient()` that returns a fresh `QueryClient`
      per request on the server and a browser singleton (the official Next/React-19 pattern), wrapped in
      `QueryClientProvider`. Defaults: `staleTime: 5_000`, `gcTime: 5 * 60_000`, `retry: 2`,
      `refetchOnWindowFocus: true`. Wrap `{children}` in `app/dashboard/layout.tsx` (dashboard-scoped).
- [x] 1.3 `lib/query-keys.ts` — the central key factory: `qk.agents(slug)`, `qk.liveSignals()`,
      `qk.metrics(slug, windowMs)`, `qk.secrets(slug)`, `qk.doctor(slug)`, `qk.github(slug)`, etc.
- [x] 1.4 `components/ui/skeleton.tsx` (shadcn: `rounded-md bg-muted animate-pulse`) + a couple of
      composed skeletons (a row-skeleton for cards/tabs).

## 2. Migrate the reported pain first — Control + Secrets + dashboard cards

- [x] 2.1 **Control (agent-cards.tsx):** replace the poll with `useQuery({ queryKey: qk.agents(slug),
      queryFn: () => getAgentStates(slug), enabled: running, refetchInterval: submittingFor ? 2000 :
      10000, placeholderData: keepPreviousData })`. Keep the legacy-codex probe as a dependent query on
      `data.length === 0`. Codex RC toggle + reconnect become `useMutation` → invalidate `qk.agents`.
      Skeleton (not "unknown") while `isPending && !placeholder`.
- [x] 2.2 **Secrets (secrets-panel.tsx):** `useQuery` for `{ secrets, requests }` (queryFn does the
      `Promise.all`); the many `load()` calls after mutations become `invalidateQueries(qk.secrets)`.
      Skeleton replaces the "Loading…". A reject now retries + errors, never sticks.
- [x] 2.3 **Dashboard cards (pod-card-list.tsx):** `useQuery({ queryKey: qk.liveSignals(), queryFn:
      getOwnerLiveSignals, refetchInterval: transitioning ? 3000 : 10000, placeholderData:
      keepPreviousData })`. The cards render instantly from the SSR'd pod list; the live chip uses a
      skeleton until the first fetch, then the cache makes every later navigation instant. Do NOT
      SSR-prefetch this (preserve the no-block-on-N-pod-healthz design).

## 3. Migrate the rest

- [x] 3.1 **Stats (pod-stats.tsx):** `useQuery` for metrics (`refetchInterval` 30s, window-keyed);
      drop the ad-hoc race+retry (react-query owns it). **term-stats.tsx** likewise.
- [x] 3.2 **health-panel.tsx** (doctor): `useQuery` (on-mount check) + `useMutation` (run/fix);
      skeleton replaces "Checking…"; a reject no longer hangs the spinner.
- [x] 3.3 **github-wizard.tsx / github-connect.tsx:** `useQuery` for status + repos; skeleton for
      "Loading your repositories…"; a reject surfaces an error, not a hang.
- [x] 3.4 **pod-cockpit.tsx:** the `getOwnerLiveSignals` header poll, and the `podUpdateProgress` /
      `t3Progress` polls, become `useQuery` (the progress ones gated by `enabled: updating/t3Enabling`).
- [x] 3.5 **diagnostics-panel.tsx** (admin): `useMutation` for the collect action (fixes the stuck
      "Collect" spinner on reject).

## 4. Remove the interim + verify + ship

- [x] 4.1 Delete `lib/use-live-data.ts` (react-query subsumes it) — confirm no remaining imports.
- [ ] 4.2 `pnpm -r build` green; `pnpm --filter @podbay/web exec tsc --noEmit` clean.
- [ ] 4.3 Real-pod click-through: each cockpit tab loads with a skeleton→data (no blank, no spinner);
      tab-away-and-back is INSTANT (cached, no "Status unavailable"/re-loading); a rejected/slow fetch
      retries and never sticks; a hard reload shows skeleton→data. Dashboard list renders instantly +
      live chips fill in without blocking.
- [ ] 4.4 Self-host (`editionOss()`) build boots with the provider (edition parity).
- [ ] 4.5 Update `openspec/specs/dashboard` (folded on archive) + `0audit.md` (the 9-fetch drift item
      is resolved by this — remove it when done); `openspec archive web-data-layer-react-query`.
