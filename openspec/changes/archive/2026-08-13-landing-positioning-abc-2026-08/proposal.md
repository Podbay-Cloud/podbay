## Why

Podbay has three coherent positioning stories—outcome-led starting points, an always-on agent
computer, and a capable home the agent knows how to use—but the current experiment and admin
console are fixed to two July variants and production is still serving A/A. We need a new,
historically separate three-arm experiment that can compare the complete landing bundles through
sign-in and activation while preserving truthful claims and operational control.

## What Changes

- Revise the `outcomes` landing to remove the absolute “No setup” promise, align playbook readiness
  with the real catalog gates, replace speculative marketplace copy with concrete workspace proof,
  and reduce repeated conceptual imagery.
- Revise the `agent-computer` landing to lead with the laptop-closing benefit, explain what the
  computer lets the agent operate, present native Claude desktop and mobile apps as the primary
  control surfaces, limit the pod visual to real lifecycle and Remote Control state, focus the
  secondary action on continuity proof, clarify the
  isolation/persistence language, and stop eager-loading below-fold images.
- Bring the existing `agent-home` composition into the rollout and instrument its primary CTAs.
- Add a new immutable `landing-positioning-2026-08-agent-home` experiment with semantic
  `outcomes`, `agent-computer`, and `agent-home` variants, approximately equal allocation, a new
  assignment cookie, deterministic preview routes, and an A/A/A validation mode before measured
  A/B/C delivery.
- Generalize server assignment, rendering, event validation, downstream attribution, reporting,
  and admin controls from a binary singleton to a registry of current and historical experiments.
- Migrate database variant constraints so all three variants can be assigned, measured, audited,
  and pinned without losing July data.
- Extend the admin console with dynamic allocation and variant controls, preview links, per-variant
  acquisition, launch/readiness progress, assignment-balance warnings, and confidence intervals or
  explicit exploratory/insufficient-evidence states.
- Preserve July experiment data and make it permanently inspectable; do not combine July A/A data
  with the new experiment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `landing-experience`: Revise the two existing landing bundles and promote `agent-home` from an
  isolated preview into a truthful, instrumented third candidate with comparable review surfaces.
- `landing-experimentation`: Support a historically separate three-arm experiment, generalized
  assignment and attribution, database-safe third-variant persistence, historical experiment
  reporting, dynamic admin controls, and three-arm launch diagnostics.

## Impact

- Web landing components, styles, root rendering, middleware assignment, analytics, auth and
  activation attribution, preview routes, metadata, and focused unit/browser tests.
- Admin experiment overview/detail pages, controls, server actions, aggregation types, and runtime
  experiment definition lookup.
- Drizzle schema and migration constraints for experiment runs, assignments, events, and audit
  records; existing July rows remain valid and queryable.
- Operations runbook and OpenSpec launch gate for A/A/A validation followed by approximately equal
  measured traffic.
- ToS-sensitive surface: every variant continues to describe users authenticating the unmodified
  official Claude Code CLI with their own supported subscription. No variant may imply proxied or
  pooled subscriptions, token resale, managed model authentication, or unsupported Codex parity.

## Non-goals

- Building a general-purpose visual experiment editor or allowing arbitrary admin-authored variants.
- Claiming a statistically conclusive winner from the operational minimum sample or from CTA rate
  alone.
- Isolating the causal effect of a single headline, CTA label, image, or section; these are complete
  positioning bundles.
- Reclassifying pilot playbooks as ready, launching community publishing, changing pricing, or
  changing the private-alpha approval flow.
- Replacing managed production databases/hosting or describing a live preview URL as a production
  deployment.
- Modifying official agent CLIs, subscription authentication, or the per-user login model.
