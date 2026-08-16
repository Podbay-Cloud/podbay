# Podbay brand assets

## Terminology (name the parts)

- **Logomark** (or just "the mark") — the icon alone: cloud + terminal-house with `>_`. Use where
  space is tight or the name is already present (favicon, app icon, avatar).
- **Wordmark** — "podbay" set in the brand type (light-blue `pod` + blue `bay`).
- **Lockup** — mark + wordmark together (the full logo you designed). Use as the primary logo.

## Files & naming

Masters live here in `brand/` (source of truth, high-res / vector). Web-served derivatives are
generated into `apps/web/public/brand/`. Naming: `podbay-<part>[-variant][-size].<ext>`.

| File | What | Use |
|---|---|---|
| `podbay-lockup.svg` / `.png` | full logo (mark + wordmark) | primary logo, landing header, README |
| `podbay-mark.svg` / `.png` | icon only | favicon source, app icon, avatar, loading state |
| `podbay-wordmark.svg` | text only | inline header when the mark is elsewhere |
| `podbay-lockup-mono-light.svg` | one-color (white) | dark backgrounds / overlays |
| `podbay-lockup-mono-dark.svg` | one-color (navy) | light backgrounds / print |

Prefer **SVG** for anything on the web (crisp at any size, tiny). Keep one high-res PNG master
(≥1024px) so raster derivatives (OG image, apple-touch-icon, store icons) can be generated.

## Generated web assets (from the mark/lockup)

Placed in `apps/web/public/`:

- `favicon.ico` (multi-size) + `icon.svg` — browser tab
- `apple-touch-icon.png` (180×180)
- `icon-192.png`, `icon-512.png` — PWA / Android
- `og-image.png` (1200×630) — social/link previews (lockup on brand background)

## Palette (sampled from the logo — replace with exact values)

| Token | Approx | Use |
|---|---|---|
| `--brand-blue` | `#2f6bff` | primary — "bay", cloud, buttons, links, accents |
| `--brand-blue-light` | `#86b0f2` | secondary — "pod", subtle highlights |
| `--brand-navy` | `#0f1e33` | the terminal-house; dark text / dark surfaces |
| `--brand-white` | `#ffffff` | the `>_`, on-blue text |

**Note:** the current site accent is coral `#d97757` (inherited from Claude). The logo defines a
blue identity — unify the site to `--brand-blue`. Sample exact hex values from the master file.

## Usage rules

- Clear space ≥ the height of the `>_` around the lockup.
- Don't recolor the mark outside the palette, distort, or add effects.
- On busy/photographic backgrounds use the mono-light lockup.
- Minimum mark size ~16px (favicon); minimum lockup width ~96px before switching to the mark.
