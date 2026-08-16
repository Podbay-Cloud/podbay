# shadcn/ui — you have the whole registry, not just what's installed

This pod ships **Next.js + Tailwind + shadcn/ui** preconfigured. A base set of components is already
installed under `src/components/ui` (button, card, input, label, badge, table, dialog, select,
dropdown-menu) — use them so the UI stays consistent.

**You are NOT limited to the preinstalled components.** The full shadcn registry (~50 components +
hundreds of blocks) is available on demand:

- **Add any component:** `pnpm dlx shadcn@latest add <name>` (e.g. `tabs`, `sheet`, `sonner`,
  `calendar`, `chart`, `accordion`, `command`, `popover`, `avatar`, `skeleton`, `tooltip`, …).
  Run `pnpm dlx shadcn@latest add` with no name to browse the full list interactively.
- **Blocks & bigger patterns** (dashboards, sidebars, auth pages) are in the registry too — pull
  the pieces you need rather than hand-rolling.
- **Theme via CSS variables** in `globals.css` (the shadcn tokens); don't fight the design system.
  For aesthetic direction and avoiding a templated look, use the `frontend-design` skill.

Prefer a shadcn component over hand-writing UI whenever one exists. Never assume a component is
missing — check/add it.

## Primitive layer: Base UI is the standard here (2026-07-28)

shadcn components wrap a headless primitive library for behavior + accessibility (focus trap,
escape-to-close, scroll lock, portals, ARIA). **This env's committed apps standardize on
`@base-ui/react`** — the Radix team's successor project. When you add a component, keep it on Base
UI; do NOT mix in `@radix-ui/*` packages alongside it, or you ship two primitive libraries with
overlapping behavior and double the bundle for no gain.

Why it matters, concretely: a hand-rolled `<div>` "dialog" loses focus trapping, escape-to-close,
scroll lock, and ARIA wiring — real accessibility regressions that are invisible until someone uses
a keyboard or a screen reader. Use the primitive, don't reinvent it.

If `shadcn add` pulls a component built on a different primitive, that's fine to use — but say so in
your summary rather than silently introducing a second library.
