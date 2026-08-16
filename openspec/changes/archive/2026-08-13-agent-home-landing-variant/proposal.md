## Why

The two existing landing variants test outcome-led building against an always-on agent computer,
but neither explains Podbay's deeper product advantage: the agent operates inside a persistent,
capable place it understands, where code, local services, scheduled work, secrets, and a live URL
can stay together. A focused third concept is needed to make that value tangible without
contaminating the active two-variant experiment.

## What Changes

- Add an `agent-home` landing composition centered on one promise: a home the coding agent knows
  how to use.
- Build a first-viewport proof story around one concrete request becoming a running system with an
  application, Postgres, recurring work, and an owner-only live URL.
- Use a focused narrative sequence covering the capable workspace, the agent-led operating loop,
  reduced service-assembly burden, ownership/trust, and one repeated access CTA.
- Add a deterministic `/preview/landing/agent-home` review route with non-indexable metadata and no
  experiment exposure or interaction measurement.
- Keep `agent-home` outside the current `landing-positioning-2026-07` assignment, storage, and
  analysis. A later measured comparison must use a new experiment identifier.
- Keep claims inside shipped boundaries: local in-pod Postgres, the in-pod operations scheduler,
  persistent home-directory project state, official CLI authentication, and private/public preview
  URLs. Do not claim general production deployment, managed-database equivalence, or universal
  scheduled-job support beyond the demonstrated capability.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `landing-experience`: Add the focused `agent-home` narrative, proof hierarchy, responsive
  behavior, CTA, accessibility, and claim boundaries.
- `landing-experimentation`: Add an isolated semantic preview route while keeping the current
  experiment definition and measurements unchanged.

## Impact

- Primary code: a new landing server composition and scoped CSS module under `apps/web/app`, plus a
  semantic preview route under `apps/web/app/preview/landing`.
- Tests: preview isolation/metadata coverage and focused assertions for the new narrative and CTA.
- Experimentation: no database, event schema, allocation, cookie, or active-variant changes.
- SEO: the new preview is `noindex` and canonicalizes to `/`.
- ToS-sensitive surface: the page describes users signing the unmodified official Claude Code CLI
  into their own pod with their own supported subscription; it does not proxy, pool, or modify model
  authentication.

## Non-goals

- Adding a third arm to `landing-positioning-2026-07` or changing its frozen control/treatment.
- Claiming Podbay replaces Neon, Supabase, or production managed infrastructure.
- Claiming the preview URL is a production deployment or custom-domain hosting.
- Generalizing the operations scheduler to every environment as part of this landing change.
- Changing product provisioning, runtime capabilities, pricing, authentication, or playbooks.
- Using fabricated customers, testimonials, usage metrics, or unlabeled customer data.
