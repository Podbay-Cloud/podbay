## Context

The user dashboard already renders inside `DashboardShell` — a client component with a fixed
left rail on desktop and a slide-in drawer on mobile, driven by a hardcoded `NAV` array and a
hardcoded `/dashboard` home link. The backoffice (`/admin`, `/admin/fleet`) never used it:
`/admin` had a bespoke `dash-head` header with pill links, and `/admin/fleet` used the page
scaffold with a manual back-link. To give the backoffice the same chrome, the shell must
become reusable with a different menu and home link, and the admin gate must live somewhere
shared.

## Goals / Non-Goals

**Goals:**
- One shell component serving both the user dashboard and the backoffice, each with its own
  menu and home link.
- Admin gating enforced once for all `/admin/*` routes.
- Active-route highlighting that treats index routes (`/admin`) exactly, not by prefix.

**Non-Goals:**
- New backoffice pages or metrics (usage, skills, fleet charts).
- Any change to the dashboard's own menu items or to `access-control` behavior.

## Decisions

**Nav is passed as data; icons are referenced by name, not by component.**
The layouts are Server Components (they call `requireAdmin` / `requireApprovedUser`), and the
shell is a Client Component. React Server Components cannot pass a function — and a lucide icon
*is* a function component — across that boundary; doing so throws "Functions cannot be passed
directly to Client Components" and drops the page into its error boundary. So `NavItem` carries
`icon: keyof typeof ICONS` (a serializable string), and the client shell owns an `ICONS`
registry mapping the name to the component. Alternative considered: make the layouts client
components — rejected, because they must run the server-only auth gate. Alternative: a
`variant: "dashboard" | "admin"` enum with both arrays baked into the shell — rejected as less
extensible and it couples the shell to knowing every surface's menu.

**Admin gate moves to the backoffice layout.**
`app/admin/layout.tsx` calls `requireAdmin()` so every current and future `/admin/*` route is
protected in one place. The per-page `requireAdmin()` calls can remain as harmless
defense-in-depth (the check is a cheap allowlist lookup), but the layout is the authority.

**Active-state matching supports an `exact` flag.**
Prefix matching (`pathname.startsWith(href)`) would light up `/admin` while on `/admin/fleet`.
Index items carry `exact: true` and match `pathname === href`; others match by prefix. This is
the same rule the dashboard's `/dashboard` item needs, so it's expressed uniformly.

## Risks / Trade-offs

- **Regression surface: the shared shell also renders the user dashboard.** Generalizing it
  risks breaking the working dashboard (and it did, once, via the icon boundary). Mitigation:
  verify both surfaces in the browser after the change — dashboard and both admin pages,
  desktop and mobile drawer — not just the new admin pages.
- **Local admin testing needs `ADMIN_EMAILS`, which `dev:fake` omits.** Mitigation: a
  `dev:fake-admin` script + `web-admin` launch config on a separate port so the backoffice is
  runnable without disturbing the default fake-dev setup.
- **Icon registry must be kept in sync.** A menu item referencing an unregistered icon name is
  a type error (the `keyof typeof ICONS` bound), so this fails at build, not at runtime.
