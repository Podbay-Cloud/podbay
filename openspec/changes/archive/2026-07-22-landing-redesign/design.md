## Context

The current server-rendered landing page is a single `page.tsx` with landing styles in
`globals.css`. It correctly branches its CTA by session state, but its terminal-led composition and
developer vocabulary predate the decision to target prompt-to-build independent/prosumer builders.

This change targets the planned pre-alpha product state, not today's one-environment state. It must
therefore land only when the six demand starters and their declared dependencies are real. The page
may show those capabilities, but it must not create substitute demos for missing product behavior.

## Goals / Non-Goals

**Goals:**

- Communicate one primary outcome and one removed obstacle without repeating that pitch in every
  section.
- Demonstrate apps, automations, and bots while keeping a stable hero and CTA.
- Use polished conceptual outcome mockups, visibly identified as examples, and keep the page fast
  and accessible.
- Explain persistence, full-workspace control, mobile/browser access, and BYO subscription as
  differentiation after the outcome is understood.
- Preserve server-side session branching and invite-only access behavior.

**Non-Goals:**

- Creating prompt-first launch or making the animated example behave like a project creation form.
- Redesigning authenticated product surfaces or establishing a new site-wide component system.
- Adding a large animation, carousel, or analytics dependency.
- Claiming native Claude/Codex app control, always-on behavior, pricing, or customer proof that is
  not verified at ship time.

## Decisions

### 1. Use a five-part page narrative with one job per section

The page will contain: (1) stable hero promise and rotating proof, (2) six-starter catalog,
(3) concrete capabilities Podbay handles, (4) consolidated differentiation, and (5) closing CTA.
There is no standalone three-step "how it works" section because the hero proof already shows
starter → direction → result.

Alternative considered: retain the current three chapter cards and add new sections below. Rejected
because it repeats the same ready-environment claim and makes a narrow product feel padded.

### 2. Keep the headline stable and rotate only the example

The hero headline is **"Build the idea. Skip the setup."** The adjacent proof cycles through a
fixed useful-app, automation, and bot sequence. Each example types once, holds long enough to read,
and crossfades to its matching result. A segmented control provides direct selection. Selection,
hover, or keyboard focus pauses automatic progression; random initial states are not used.

The typing surface is explicitly an example of directing the agent, not an active landing input.
This avoids implying prompt-first launch. If prompt-first launch becomes real before apply, changing
that contract requires updating this design and its requirements first.

Alternative considered: rotate headlines or randomize the hero. Rejected because it produces
inconsistent first impressions, weakens measurement, and can hand some visitors a narrower pitch.

### 3. Use conceptual example outcomes as the primary graphics

Create polished, product-specific mockups for the useful-app, automation, and Telegram-bot stories.
They should depict plausible finished outcomes rather than generic stock scenes, use a consistent
visual system, and be stored as optimized local assets with explicit dimensions and responsive
crops. Each hero state must include a persistent, readable cue such as "Example project" so a
visitor cannot reasonably mistake it for a customer project or captured live product. Starter cards
can reuse purpose-made crops or restrained graphic treatments from the same system.

Conceptual assets may be created before the starters are complete. They are illustrative, not proof
that a capability has shipped; copy and availability claims remain subject to release-time review.

Alternative considered: wait for real starter captures. Rejected for the first version because it
couples design iteration to the full pre-alpha build sequence. Real captures remain a later upgrade
when representative outcomes are stable.

### 4. Isolate interaction while preserving server rendering

Keep the page and session-aware CTA in a server component. Put the typed sequence, manual selector,
timers, and analytics hooks in one small client component. Use scoped landing styles (prefer a CSS
module) and existing fonts/tokens where appropriate; add no animation or UI library. Images use the
Next image pipeline and fixed responsive dimensions to avoid layout shift.

Alternative considered: make the whole landing a client component. Rejected because session-aware
rendering and static content do not need client state.

### 5. Treat accessibility and performance as part of the visual design

The rotating content is not an assertive live region. Assistive technology receives a stable
summary and usable manual controls rather than every typed character. `prefers-reduced-motion`
disables typing/autoplay and presents the default result with manual selection. Motion uses
transform/opacity where possible; controls have visible focus, examples remain readable at 320px,
and no moving layer may cover the CTA or copy.

### 6. Use stable interaction events without binding to a vendor

Define event names for primary CTA activation, example selection, and starter selection. Route them
through a tiny landing analytics adapter. If no analytics backend is configured when applied, the
adapter is a production-safe no-op and the stable event contract remains testable; choosing or
installing an analytics vendor is a separate change.

### 7. Keep subscription claims precise

Copy can say users bring their Claude or Codex subscription and Podbay adds no token markup. It
cannot say Podbay controls model billing, pools access, modifies the CLI, or guarantees vendor-native
mobile synchronization. The page describes browser-based mobile reachability unless vendor parity
has been separately verified and approved.

## Risks / Trade-offs

- **[Conceptual screenshots are mistaken for real customer output]** → Label every hero state as an
  example, avoid customer names/testimonials, and keep capability claims separate from the imagery.
- **[Typing animation feels clichéd or distracting]** → Keep it subordinate to the stable headline,
  deterministic, manually controllable, pausable, and absent under reduced motion.
- **[Three examples make the hero visually heavy]** → Render one outcome at a time in a fixed-size
  frame and reuse the same visual grammar across states.
- **[Conceptual mockups drift from the eventual product]** → Keep editable source/prompt notes with
  the assets and schedule replacement with real captures once the starters stabilize.
- **[Copy overpromises always-on behavior]** → Review every persistence/mobile claim against the
  final wake/sleep behavior before release.
- **[No analytics provider exists]** → Preserve a no-op adapter and event contract without expanding
  this change into analytics infrastructure.

## Migration Plan

1. Storyboard and create the three labeled conceptual outcomes and starter imagery.
2. Implement the landing behind the existing `/` route with unchanged access destinations.
3. Confirm all public availability claims against the actual pre-alpha dependency and starter state.
4. Verify desktop/mobile/reduced-motion layouts and the landing access flow before deployment.
5. Roll back by reverting the landing page, component, styles, metadata, tests, and local assets;
   no database or API migration is involved.

## Open Questions

- Which analytics backend, if any, will consume the stable landing event contract at apply time?
- Should the default useful-app mockup use the SaaS starter or a narrower internal-tool outcome?
  Choose during storyboarding based on which concept is clearest at phone and desktop sizes.
