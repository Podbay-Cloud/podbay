## Why

Pre-alpha concern #1 (UX): the dashboard reads like a debug list — a centered single column of
full-width pod rows — with concrete breakage: the "New pod" button is full-width (reuses the
`width:100%` auth-card `.gh`), the empty state renders a duplicate CTA, and each pod's 5–6 action
buttons wrap under the name on narrow widths. Before inviting real users it must look intentional
and work on mobile. Plan of record: `docs/dashboard-redesign-plan.md`.

## What Changes

- **Sidebar shell** (nav only): clickable logo → `/dashboard`; nav (Pods · New pod · Settings);
  a **user menu pinned bottom** (dropdown holding Saved logins + Sign out — moved out of the
  top-right and the page's bottom section).
- **Pods → responsive card grid.** Card = editable **name** + slug (mono/muted), env chip + status
  badge + last-active, a **primary action** (Open when running / Wake when sleeping) and a **`⋯`
  overflow menu** (Sleep/Wake, Preview + public toggle, Delete).
- **Pod naming:** `pods.name` (nullable → falls back to slug) with **inline rename** on the card.
- **Mission control (env-led):** an **env gallery strip** (tiles from the catalog, each stating
  what's prepared) that **doubles as the empty state** — zero pods never means an empty page, and
  the marketplace story shows even at 3–5 envs. Each pod card reserves a **mini-terminal-preview
  slot** (env-icon placeholder) + an **agent-state dot**; live data is the separate `pod-peek`
  follow-up change, so this redesign stays UI-only.
- **Empty state:** the gallery + exactly one inviting CTA.
- **Mobile-first:** cards collapse to one column; sidebar becomes a top bar / drawer. No content
  overflow; a small dashboard button variant replaces the full-width `.gh`.

Deferred: live peek data (`pod-peek` change), pod stats, per-pod skills/theme (post-alpha).

## Impact

- DB: `pods.name text` (nullable) + migration (direct-SQL to Neon); `PodRecord.name`;
  `DrizzlePodStore`; `PodService.setName`; `renamePod` server action.
- Web: dashboard `layout.tsx` + `<DashboardShell>`/`<UserMenu>`; `<PodCard>` + `<PodCardMenu>`
  (folds `PodRowActions`); `globals.css` sidebar + card-grid + mobile.
- Tests: e2e (desktop + **mobile viewport**) for cards/rename/actions/empty-state; unit for
  `renamePod` + `setName`.
