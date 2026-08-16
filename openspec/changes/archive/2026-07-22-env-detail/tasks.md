## 1. Catalog + detail data

- [x] 1.1 `CatalogEntry` gains `author: string | null` and a `capability` summary (agents, base
  kind, secretCount, requiredSecretCount, skillCount) for the tile line
- [x] 1.2 `getEnvironmentDetail(name)` — resolve one env to a pitch object: description, author,
  tags, agents, base kind, declared secrets, network policy, `.claude` skills + rules; null when
  the env is unknown/invalid
- [x] 1.3 Unit tests: capability derived correctly from a fixture env; unknown env ⇒ null

## 2. Detail page + tiles

- [x] 2.1 `/dashboard/environments/[name]/page.tsx` — full pitch + "What's prepared" capability
  summary + the Launch dialog (reused)
- [x] 2.2 Tile: author + compact capability line + a "Details" link to the detail page; keep Launch
- [x] 2.3 Styling consistent with the gallery/dialog

## 3. Tests + e2e

- [x] 3.1 Detail route renders a known env's capability + Launch
- [x] 3.2 e2e: gallery → Details → capability visible → Launch dialog opens
- [x] 3.3 Leak-scan; `pnpm -r build` + suites green
