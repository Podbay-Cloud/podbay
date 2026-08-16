## Why

The env gallery is a flat grid of name + description + tags + Launch. For a marketplace it's
too thin: a prospective launcher can't see **what a pod actually comes with** — which agent,
what base, which keys it needs, what skills/rules are wired — before committing. `env-detail`
adds the "listing" half of `env-listings` (the launch half shipped as `launch-config`): a
per-env **detail page** with the full pitch and a **capability summary** on both the tile and
the page, sourced from the resolved env (no new authoring burden).

## Decisions

- **Detail page** at `/dashboard/environments/[name]`: description, author, tags, and a
  "What's prepared" capability summary — agent(s), base kind (devcontainer/image/dockerfile),
  declared secrets (key + description + required), network policy, and the `.claude` layer
  (skill and rule names). Plus the Launch dialog (reused from `launch-config`).
- **Capability summary is derived, not authored.** Read from `resolveWithConfig` + metadata —
  every env gets it for free; nothing new to write in `podbay.yaml`.
- **Tiles gain a compact capability line + author + a "Details" link.** Launch stays on the
  tile (fast path); "Details" opens the page (considered path). No screenshots yet.
- **Read-only, owner-agnostic.** The catalog/detail is public within the dashboard; no secret
  values, only declared *shapes*. Same leak discipline.

## What Changes

- **web/lib**: `getEnvironmentDetail(name)` resolves one env to a pitch object (author +
  capability summary); `listEnvironments` gains `author` + a small `capability` summary for the
  tile line.
- **web**: `/dashboard/environments/[name]/page.tsx` detail route; tile shows author + a
  capability line + "Details" link; the detail page embeds the Launch dialog.
- **tests**: unit tests for `getEnvironmentDetail` (capability derived from a fixture env); the
  detail route renders; e2e: tile → Details → capability visible → Launch.

## Deferred (own follow-ups within env-listings)

- **Staged progress view** (real machine-event stage jumps) — distinct concern, its own change.
- **Option toggles / size picker / skill toggles** at launch — need `podbay.yaml` `options` +
  `resources` schema and provider guest-size support.
- **Screenshots / gallery images** — needs an asset story.
