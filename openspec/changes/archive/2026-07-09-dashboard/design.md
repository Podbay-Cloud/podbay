## Context

All backend layers exist; the dashboard is the UI that composes them: `auth` (who), the
environment catalog (`@podbay/shared` + `environments/`), and `control-plane` (launch/list/lifecycle
over the Neon store + Fly provider). It replaces the `/dashboard` stub. The terminal is already at
`/pods/:slug` (the Next route folder is renamed `[id]` → `[slug]` for clarity); the dashboard is
how you get there. Routes follow the hybrid scheme decided in **docs/url-structure.md**: `/dashboard`
is the signed-in home; the shared destinations `/pods/:slug` and `/new` live at the root.

## Goals / Non-Goals

**Goals:**
- Environment catalog (pure, testable) + owner-scoped pod list + launch + lifecycle actions.
- Works against the real Neon store now; provisioning guarded until Fly is wired.

**Non-Goals:**
- Live gateway/Fly deploy; marketplace submissions; teams; billing; rich per-pod settings.

## Decisions

- **`getPodService()` factory reads env.** Always constructs `DrizzlePodStore` (Neon is
  configured). Constructs `FlyProvider` only when `FLY_API_TOKEN` is present. `isProvisioningEnabled()`
  gates launch. Read paths (`listPods`) don't touch the provider, so the dashboard is useful before
  Fly exists. _Alternative:_ require Fly for the whole dashboard — needlessly blocks the list/catalog.
- **Server actions, not client fetch.** Launch/wake/sleep/delete are Next server actions:
  `requireUser()` → `getPodService()` → owner-scoped control-plane call → `revalidatePath`. Keeps
  the control plane and secrets server-only; no API surface to secure separately.
- **Catalog is a pure helper.** `listEnvironments(root)` reads dirs, runs `validateEnvironment`,
  returns metadata; invalid dirs are skipped. Unit-tested against `environments/`.
- **`/new` is a root-level launcher page, not a dashboard tab.** Per docs/url-structure.md, the
  catalog + launch live at `/new` (accepting `?env=` to preselect) so the launch link is short
  and badge-friendly (the future "Launch on Podbay" primitive); `/dashboard` stays the pods list.
  The `?env=` param survives sign-in (unauthenticated `/new?env=x` → signin → back to `/new?env=x`).
- **Memorable slugs instead of UUIDs.** `control-plane` generates `adjective-noun-4hex` pod ids
  (one string = DB key + URL + Fly tag), with a store-lookup collision retry. The control-plane
  spec never mandated UUIDs, so this is an implementation change (no delta spec).
- **Launch → redirect to `/pods/:slug`.** On success `redirect('/pods/'+slug)` lands the user in
  the workspace. Matches "one click to a running agent."
- **Reuse control-plane ownership semantics.** Actions pass the auth `user.id` as `ownerId`;
  cross-owner is already not-found. No new authz.

## Risks / Trade-offs

- **Provisioning needs live Fly** → guarded state now; the list + catalog still render, so the
  dashboard isn't dead before the Fly wiring. Documented.
- **Server actions are hard to unit-test** (auth + DB + provider) → test the pure catalog helper;
  the action/UI path is a manual/integration check once Fly + a session exist. Same pattern as
  prior UI-adjacent changes.
- **Stale status in the list** → the list shows the stored status; a later refresh/reconcile or the
  gateway's activity updates keep it current. Acceptable for v0; a manual refresh reconciles.
- **Empty/first-run state** → show the catalog prominently when the user has no pods.

## Migration Plan

Replaces the `/dashboard` stub with the real page; additive helpers/actions. Nothing to migrate.
Full launch works once `FLY_API_TOKEN` + the pods app are set (the live path). Rollback = revert.

## Open Questions

- Whether Delete should confirm in-UI (guard against accidental pod loss). Leaning: a simple
  confirm before destroy.
- Whether to reconcile each pod's status on dashboard load (provider round-trips) or trust the
  stored status. Leaning: trust stored + a manual refresh action for v0 to avoid N provider calls.
- `nuqs` for URL param state is deferred (docs/url-structure.md) — `?env=` is a single server-read
  param now; adopt nuqs when the pod workspace grows client-side tabs.
