## Why

A signed-in user lands on a stub dashboard ("Signed in as …") with nowhere to go. Every backend
piece to run a pod exists — auth gives a real user, `control-plane` launches and lists pods from
the Neon store, and `/pods/:slug` renders a terminal — but nothing ties them together in a UI. This
change builds the **dashboard**: browse the environment catalog, launch a pod, and see/open/manage
your pods. It's the surface that makes the product navigable end to end (the terminal itself still
needs the live gateway, but launching and listing work against the real DB now).

## What Changes

- **Environment catalog** — `listEnvironments()` reads `environments/*`, validates each via
  `@podbay/shared`, and returns display metadata (name, description, tags). A pure, testable helper.
- **Pod-service factory** — `getPodService()` builds `PodService` from env: `DrizzlePodStore`
  (Neon) always, `FlyProvider` when `FLY_API_TOKEN` is set. Read paths (list pods) work without
  Fly; provisioning is guarded when Fly isn't configured yet.
- **Server actions** (all `requireUser`-gated, owner-scoped): `launchPod(environmentName)` →
  provision → redirect to `/pods/[slug]`; `wakePod` / `sleepPod` / `destroyPod`.
- **Memorable pod slugs**: `control-plane` generates `adjective-noun-4hex` slugs
  (`misty-otter-4f2a`) as the pod id instead of UUIDs — one string is the DB key, the URL, and
  the Fly tag (per docs/url-structure.md).
- **Dashboard page** (`/dashboard`, the signed-in home): the user's pods with status +
  last-active + actions (Open / Wake / Sleep / Delete), and a link to the launcher.
- **Launcher page** (`/new`, root-level per the URL scheme): the environment catalog with a
  Launch action; accepts the shareable `?env=<name>` param to preselect (the future
  "Launch on Podbay" badge target). The param survives the sign-in round-trip.
- Tests: `listEnvironments()` against the real `environments/` dir + slug-generator tests; the
  server actions/UI are a documented manual/integration check (need auth + DB + provider).

## Capabilities

### New Capabilities
- `dashboard`: the environment catalog, owner-scoped pod list + lifecycle actions, and the launch
  flow — the authenticated home surface.

### Modified Capabilities
<!-- control-plane behavior detail: pod ids become memorable slugs (spec never mandated UUIDs,
     so no delta spec needed — implementation change only, noted in design). -->

## Impact

- `apps/web`: `lib/environments.ts` (catalog), `lib/pod-service.ts` (factory), server actions, and
  a real `/dashboard` page (replacing the stub). Depends on `@podbay/control-plane`,
  `@podbay/provider`, `@podbay/db`, `@podbay/shared`.
- **Provisioning is fully functional only once Fly is wired** (`FLY_API_TOKEN` + the pods app);
  until then the dashboard lists pods and shows the catalog, and Launch surfaces a "not yet
  enabled" state rather than failing.
- Consumed by users directly; the last major surface before the product is navigable end to end.
- Non-goals (explicit): the live gateway/Fly deploy (separate); marketplace submissions/community
  publishing; teams/orgs; billing; per-pod settings beyond the core lifecycle.
