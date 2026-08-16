## 1. Generalize the shell

- [x] 1.1 Make `DashboardShell` accept `nav: NavItem[]` and `homeHref`, and drive the brand
  link, menu, and mobile drawer from them
- [x] 1.2 Reference nav icons by name via an `ICONS` registry inside the client shell (no icon
  components crossing the Server→Client boundary)
- [x] 1.3 Support an `exact` flag on `NavItem` so index routes match `pathname === href`

## 2. Backoffice layout + gate

- [x] 2.1 Add `app/admin/layout.tsx` that calls `requireAdmin()` and renders `DashboardShell`
  with the admin menu (Access requests, Fleet, Back to app) and `homeHref="/admin"`
- [x] 2.2 Point `app/dashboard/layout.tsx` at the generalized shell, passing the dashboard menu

## 3. Simplify the backoffice pages

- [x] 3.1 Rewrite `app/admin/page.tsx` to render Access requests into the shared page scaffold
  (drop the bespoke `dash-head` header and pill links)
- [x] 3.2 Remove the redundant back-link from `app/admin/fleet/page.tsx` (sidebar owns nav)

## 4. Local admin dev tooling

- [x] 4.1 Add a `dev:fake-admin` npm script (sets `ADMIN_EMAILS`) and a `web-admin` launch
  config on a separate port

## 5. Verify

- [x] 5.1 Typecheck passes; `access-rules` unit tests pass
- [x] 5.2 Browser: `/admin` and `/admin/fleet` render inside the sidebar with correct
  active-state; Back to app returns to the dashboard; mobile drawer shows the admin menu
- [x] 5.3 Browser: the user dashboard still renders (no regression from generalizing the shell)
- [x] 5.4 Add/extend an e2e assertion that the backoffice renders inside the sidebar and a
  non-admin is denied every `/admin/*` route (currently covered only for `/admin`)

## 6. Finalize

- [x] 6.1 `openspec validate backoffice-sidebar --strict` passes
- [x] 6.2 Commit on the `backoffice-sidebar` branch (leak-scan staged diff first)
- [x] 6.3 Archive the change once merged (`/opsx:archive`)
