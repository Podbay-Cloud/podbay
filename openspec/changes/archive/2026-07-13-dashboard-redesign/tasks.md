## 1. DB + control-plane: pod name

- [x] 1.1 `db/schema.ts`: `name text` (nullable) on `pods`; migration (direct-SQL to Neon)
- [x] 1.2 `PodRecord.name`; `DrizzlePodStore` map + insert + update; `InMemoryPodStore` covered
- [x] 1.3 `PodService.setName(ownerId, id, name)` (owner-scoped; empty → null)
- [x] 1.4 `apps/web/lib/actions.ts`: `renamePod(slug, name)` server action

## 2. Shell

- [x] 2.1 `apps/web/app/dashboard/layout.tsx` + `<DashboardShell>` — sidebar (logo, nav, bottom
  user menu); page becomes the content pane
- [x] 2.2 `<UserMenu>` dropdown absorbing `SignOutButton` + `<SavedLogins>`

## 3. Cards (mission-control)

- [x] 3.1 `<PodCard>` replaces `pod-row`: name (inline rename) + slug, env chip + status + ago,
  primary Open/Wake, `<PodCardMenu>` (`⋯`)
- [x] 3.2 `<PodCardMenu>` folds `PodRowActions`: Sleep/Wake, Preview + public toggle, Delete;
  keep server-driven destroying/preview state
- [x] 3.3 Reserved **mini-terminal-preview slot** (env-icon placeholder) + **agent-state dot**
  (static: idle — live data is the `pod-peek` follow-up, NOT here)

## 3b. Env gallery strip (env-led)

- [x] 3b.1 `<EnvGallery>` — env tiles from `listEnvironments()` (name, what's prepared, launch);
  a "Launch something new" strip on the dashboard
- [x] 3b.2 Gallery **doubles as the empty state** (zero pods → gallery + one CTA, no duplicate)

## 4. CSS + mobile

- [x] 4.1 `globals.css`: sidebar + card grid (`repeat(auto-fit, minmax(0,1fr))`); small dashboard
  button variant (retire full-width `.gh` on the bar); dropdown menu
- [x] 4.2 Mobile: cards → 1 column; sidebar → top bar / drawer; no overflow

## 5. Verify

- [x] 5.1 Unit: `renamePod` action + `setName` store update (pglite)
- [x] 5.2 e2e (`apps/web/e2e`): cards render; rename persists; Open/Wake/Sleep/Delete/preview
  toggle from card + menu; empty state one CTA
- [x] 5.3 e2e **mobile viewport**: one-column cards, no horizontal overflow, menu opens/acts
- [x] 5.4 Visual pass at desktop + mobile widths (manual by owner)
