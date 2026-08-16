## Why

The current landing page presents Podbay as an outcome-led starter catalog, while the product's
newest and most concrete differentiation is an always-on, isolated computer for an existing coding
agent. Podbay needs a genuine experiment that can compare those positioning narratives using
downstream activation, not just publish a replacement page and infer from clicks.

## What Changes

- Preserve the current outcome-led landing as the `outcomes` control and add an
  `agent-computer` treatment centered on 24/7 continuity, off-device execution, bring-your-own
  subscription, prepared playbooks, and the real launchable environment catalog.
- Make `/` a server-rendered experiment entry point that assigns eligible signed-out visitors
  evenly and persistently to one variant without redirects or client-render flicker.
- Add semantic forced-preview routes at `/preview/landing/outcomes` and
  `/preview/landing/agent-computer`; preview traffic is excluded from assignment and measurement,
  is not indexed, and declares `/` as canonical.
- Add first-party experiment attribution and same-origin event ingestion for exposure, primary CTA,
  sign-in completion, pod creation, agent connection, and first project open.
- Carry anonymous attribution through sign-in so variant performance can be evaluated by activation
  and later return, not only landing interactions.
- Add an admin experiments console with experiment list/detail views, read-only configuration,
  per-variant funnel and acquisition breakdowns, assignment/ingestion health, and a sanitized recent
  event stream.
- Permit only two guarded experiment mutations in the admin console: stop the experiment and pin a
  variant. Both actions require confirmation and write an immutable admin audit record; experiment
  identity, allocation, metrics, and content remain code-defined and immutable after launch.
- Keep a stable experiment identifier and semantic variant identifiers in all events, with
  deduplicated exposure recording and test coverage for assignment, previews, metadata, analytics,
  and responsive landing behavior.
- Treat the treatment as a complete positioning bundle. Headline, narrative order, visual proof,
  and catalog content may differ together; this is not a single-element headline test.

## Capabilities

### New Capabilities

- `landing-experimentation`: Stable visitor assignment, forced previews, experiment attribution,
  same-origin measurement, and downstream conversion linkage for landing tests.

### Modified Capabilities

- `landing-experience`: Replace the single mandatory outcome-led narrative with two truthful landing
  variants and define the treatment's agent-computer positioning, real environment proof, metadata,
  accessibility, and claim boundaries.

## Impact

- Primary surfaces: `apps/web/app/page.tsx`, landing components and styles,
  `apps/web/middleware.ts`, landing analytics, authentication attribution, pod activation paths,
  admin routes/actions, metadata, and focused unit/end-to-end tests.
- Persistence: a small experiment event and attribution store in the existing Postgres/Drizzle
  layer, or an equivalently durable first-party store selected in design.
- SEO: `/` remains the only canonical landing URL; preview routes are non-indexable.
- Privacy: attribution uses an opaque anonymous identifier and does not require raw IP storage.
- ToS-sensitive surface: the treatment may say users bring their own Claude or Codex subscription
  and that Podbay uses unmodified official CLIs with no token markup. It must not imply pooled
  subscriptions, proxied model authentication, control over vendor billing, or client support that
  is not production-ready.

## Non-goals

- Selecting or integrating a third-party product analytics vendor.
- Building a general-purpose visual experiment editor or allowing live edits to allocation,
  metrics, variants, or landing content.
- Changing pricing, access approval, authentication providers, or the per-pod agent login model.
- Claiming unrestricted Codex parity, arbitrary native-terminal access, immortal vendor sessions,
  complete malicious-skill prevention, or egress protection that is not shipped.
- Determining which individual treatment element caused a result; later experiments can isolate
  headlines, visuals, or section order after the positioning winner is known.
- Publishing planned playbooks as available before their launch and dogfood gates pass.
