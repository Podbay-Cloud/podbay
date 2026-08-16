## Why

The current landing page leads with developer environments and a terminal, while the pre-alpha
demand audience is independent builders who first care about making a useful app, bot, game, or
automation without assembling its infrastructure. The pre-alpha catalog and enabling capabilities
now provide enough concrete product proof to replace the sparse, supply-side page with a focused,
outcome-led experience.

## What Changes

- Replace the developer-oriented hero with the stable promise **"Build the idea. Skip the setup."**
  and concise copy for people who already build with Claude or Codex.
- Demonstrate breadth through a deterministic, accessible typing sequence covering a useful app,
  an automation, and a bot, synchronized with outcome visuals and manual controls.
- Replace the terminal-led hero visual with polished conceptual outcome mockups, clearly framed as
  examples rather than customer projects or captured product output; retain terminal/full-workspace
  access only as supporting proof.
- Present the six planned demand starters with outcome-led names and nontechnical descriptions.
- Keep the page lean: hero, starter catalog, concrete proof of what Podbay handles, consolidated
  differentiation, and one closing call to action. Remove sections that restate the hero promise.
- Preserve invite-only access behavior while making signed-out and signed-in calls to action
  coherent.
- Update page metadata and add focused responsive, accessibility, reduced-motion, and landing-flow
  coverage.
- Add lightweight interaction analytics for primary calls to action and starter/example selection,
  using the project's available analytics mechanism if one exists at implementation time.

## Capabilities

### New Capabilities

- `landing-experience`: Outcome-led landing content, starter presentation, animated example proof,
  responsive behavior, accessibility, metadata, and interaction measurement.

### Modified Capabilities

- `access-control`: Extend landing access behavior so authenticated visitors are offered the
  dashboard while signed-out visitors retain GitHub sign-in as the access-request path.

## Impact

- Primary implementation surface: `apps/web/app/page.tsx`, landing-specific components, global or
  landing-specific styles, metadata, and web tests.
- The page describes the planned pre-alpha state after `pod-secrets`, preview activation,
  `env-listings`, the six demand starters, and scheduled wake are available; those dependencies are
  not implemented by this change. Conceptual visuals may be produced before those dependencies,
  but public availability claims must still match the product state at release.
- No model authentication is wrapped or proxied. Copy may state that users bring their own Claude
  or Codex subscription and that Podbay does not add token markup, but it must not imply pooled
  subscriptions, modified CLIs, or verified native-app behavior that the product does not control.

## Non-goals

- Implementing prompt-first project launch, starter environments, secrets, preview activation,
  scheduled wake, pricing, or marketplace publishing.
- Redesigning sign-in, pending, dashboard, launcher, terminal, or other authenticated surfaces.
- Presenting conceptual mockups as customer projects, live product captures, or evidence of shipped
  capabilities; publishing testimonials, customer counts, performance claims, or popularity
  rankings without verifiable evidence.
- Building a heavyweight media carousel, decorative animation system, or new site-wide design
  system.
