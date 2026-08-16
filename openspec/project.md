# Podbay — project conventions

Conventions the opsx workflow assumes for this repo. (Stack, scope, and roadmap
live in `docs/`; this file is the short list of process rules.)

## Change discipline

- One opsx change at a time: propose → apply → archive, one green commit at archive.
- Keep `tasks.md` checked off as work lands, not reconstructed after.
- Verify on real infra / the real running flow before declaring a change done or
  handing off (never assume it works because unit tests pass).

## User-flow changes ship with e2e flow specs

Any change that adds or alters a user-facing flow (auth, gating, launch, pod
lifecycle, admin, dashboard, terminal) MUST add or update a Playwright flow spec
in `apps/web/e2e/` in the same change, and the suite must pass before archive.
The suite is hermetic (`pnpm e2e`, needs Docker) — see `apps/web/e2e/README.md`.
This exists because a run of flow bugs (cookie loop, delete-state, launch
routing, build-env) each reached the user as a manual-test regression; the suite
is how we stop being the CI.
