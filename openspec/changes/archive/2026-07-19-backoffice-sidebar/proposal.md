## Why

The backoffice (admin surface) grew by accretion: `/admin` (access requests) came first,
then `/admin/fleet` was bolted on during the 2026-07-17 dogfood, wired together only by
one-off "pill" back-links. There is no shared chrome, no persistent menu, and no single
place that gates admin access. The observability plan expects this surface to keep growing
(usage, skills, richer fleet views), so it needs real navigation now — a sidebar with the
admin destinations as menu items — before more pages are added onto a dead-end pattern.

## What Changes

- Introduce a shared, admin-only **backoffice shell**: the same sidebar chrome the user
  dashboard already uses (logo, vertical nav, bottom account menu), carrying the admin menu.
- The admin menu surfaces every backoffice destination as a first-class item: **Access
  requests**, **Fleet**, and **Back to app** (return to the user dashboard). The active
  route is highlighted.
- Admin access is enforced **once at the backoffice layout**, so every `/admin/*` route is
  gated by the layout rather than each page repeating the check.
- Generalize the existing dashboard shell to accept its nav items + home link as data, so a
  single component serves both the user dashboard and the backoffice. Nav icons are
  referenced by name (not passed as components) to stay on the right side of the Next.js
  Server→Client boundary.
- The two existing admin pages drop their bespoke headers / back-links and render into the
  shared page scaffold, since the sidebar now owns navigation.

## Capabilities

### New Capabilities
- `backoffice`: the admin-only backoffice surface — its shared sidebar navigation, the menu
  of admin destinations with active-state, layout-level admin gating for all `/admin/*`
  routes, and a link back to the user app.

### Modified Capabilities
<!-- None. access-control already specifies admin gating + the access-requests page and its
     approve/revoke behavior; this change alters how that page is *reached* (navigation
     chrome), not any access-control requirement. -->

## Non-goals

- No new metric families or pages (usage, skills, richer fleet charts) — this change only
  adds the navigation frame those will later slot into.
- No change to the user dashboard's own menu items or behavior (only the shared shell is
  generalized).
- No change to `access-control` rules: who is an admin, how approval works, and that
  non-admins are denied all stay exactly as specified.

## Impact

- **ToS-sensitive surface:** none. This touches only internal admin navigation and the
  admin gate (which reads the existing `ADMIN_EMAILS` allowlist). No model-auth proxying,
  no CLI invocation, no subscription handling is added or changed.
- **Code:** `apps/web/components/dashboard-shell.tsx` (generalized to take nav data),
  `apps/web/app/dashboard/layout.tsx` (passes its own nav), new
  `apps/web/app/admin/layout.tsx` (backoffice shell + admin gate),
  `apps/web/app/admin/page.tsx` and `apps/web/app/admin/fleet/page.tsx` (render into the
  shared scaffold; drop back-links).
- **Dev tooling:** a `dev:fake-admin` npm script + a `web-admin` launch config so the
  admin-gated backoffice is runnable locally (the default `dev:fake` sets no `ADMIN_EMAILS`).
- **Auth/gating behavior** is unchanged; only the enforcement point moves to the layout.
