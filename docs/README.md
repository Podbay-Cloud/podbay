# Podbay docs

**System behavior truth lives in [`openspec/specs/`](../openspec/specs/), not here.**
If a doc would describe *how the deployed system behaves right now*, that belongs in a
spec. `docs/` holds only the things a spec can't: strategy, forward plans, and runbooks.

Migration in progress (2026-07-22): moving system-behavior docs into specs and adopting
OpenSpec as the source of truth — see [plans/openspec-migration.md](plans/openspec-migration.md).

## Structure

- **[`strategy/`](strategy/)** — business/product/GTM: positioning, pricing, audience,
  roadmap, partnerships, security model, infra strategy. The durable *why/where*. Never a spec.
- **[`plans/`](plans/)** — forward-looking implementation plans (not yet built) + the pre-alpha
  execution plan. When a plan ships, its truth moves to a spec and the plan is archived. Some
  entries here are pending migration into specs (see the migration map).
- **[`runbooks/`](runbooks/)** — how to *operate* podbay: deploy, terminal debugging, image
  rebuild, topology, URL scheme. Procedures, not user-facing capabilities.

Each doc opens with a **`**Status:**`** line (`strategy` / `plan of record` / `brainstorm` /
`superseded` / `obsolete`). A ⚠ banner means a doc carries stale premises (mostly pre-2026-07-20
pivot: Fly billing, sleep economics) — see the banner for what survives.

## Conventions

- **Shipped behavior → a spec** (was "→ `docs/reference/`"; that convention is retired). A plan
  that ships is recorded in `openspec/specs/`, not moved to a reference doc.
- **Domain/feature-affecting change → OpenSpec ceremony.** The hard rule is *specs stay current*
  (update the affected `specs/` in the same commit); the propose/archive lifecycle can catch up.
  See `.claude/rules/spec-driven.md` and `CLAUDE.md`.
- **Known issues, deferrals, and drift live in [`../0audit.md`](../0audit.md)** — updated on every push.
