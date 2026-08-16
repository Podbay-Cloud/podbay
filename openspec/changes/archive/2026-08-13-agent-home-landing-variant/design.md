## Context

Podbay currently has two complete landing compositions. `outcomes` leads with a broad catalog of
things a visitor can build; `agent-computer` leads with persistence, off-device execution, and
multi-device access. Both are useful, but the first diffuses attention across four outcomes and the
second proves where the agent runs rather than what the agent can operate there.

The third concept explores a distinct product belief: a capable agent becomes substantially more
useful when code, durable project context, local services, recurring work, secrets, and a reachable
application live in one place the agent understands. The page must make that idea concrete enough
to earn an alpha-access click while remaining outside the current measured experiment.

The implementation is isolated in a separate Git worktree because another agent is concurrently
changing the primary checkout. The resulting branch can be reviewed, rebased, and merged without
sharing an index or mutable working files.

## Goals / Non-Goals

**Goals:**

- Communicate one promise in the first viewport: a home the agent knows how to use.
- Turn an abstract infrastructure claim into one legible before/after proof story.
- Use layout, contrast, specificity, progressive disclosure, and risk reduction to make the primary
  CTA the natural next action.
- Show shipped capabilities without presenting a preview as production deployment or in-pod
  Postgres as a managed-database replacement.
- Produce a deterministic, responsive preview that can be evaluated before any future experiment.
- Leave the current experiment configuration, allocation, storage, and narratives untouched.

**Non-Goals:**

- Building a three-way experiment or selecting a winning position.
- Adding new runtime, scheduler, database, deployment, or URL capabilities.
- Reusing the outcomes catalog or making the page explain every Podbay feature.
- Creating a literal house illustration, mascot, or sentimental visual metaphor.
- Adding testimonials or metrics that Podbay cannot substantiate.

## Decisions

### 1. Treat `agent-home` as a new thesis, not a rewrite of `agent-computer`

The page's axis is operational capability: what the agent can configure, run, revisit, and hand
back. Always-on behavior appears as supporting infrastructure, not the headline. The page omits the
playbook grid so visitors do not have to reconcile a workspace category with four separate product
ideas.

Alternative considered: change the existing treatment headline to “Give your agent a home.”
Rejected because the current treatment is a frozen positioning bundle and because a headline-only
change would leave the rest of the page proving the wrong thesis.

### 2. Use one request-to-running-system proof in the hero

The hero graphic is code-native and resembles a real workspace status surface rather than a stock
house, generic terminal, or conceptual customer app. One request asks for a recurring customer
report with stored history and a private dashboard. The response shows four verified building
blocks: application, Postgres, schedule, and owner-only URL.

This visual answers the visitor's immediate question—“what does home let the agent do?”—beside the
CTA. The page labels it as a product walkthrough with simulated project data.

Alternative considered: animate several example prompts. Rejected because multiple examples add
choice and motion before the visitor understands the category.

### 3. Build the CTA hierarchy around motivation, ability, and reduced anxiety

The first viewport uses:

1. a short category eyebrow for orientation;
2. the emotionally resonant headline “A home your agent knows how to use”;
3. concrete capability copy that makes “home” non-metaphorical;
4. one high-contrast primary action, “Give my agent a home”;
5. one low-commitment anchor, “See what's inside”;
6. compact friction reducers: private alpha, GitHub sign-in, own subscription, official CLI.

The primary CTA repeats only after the page has supplied capability and trust proof. Signed-in
visitors receive the existing dashboard action instead of acquisition copy.

Alternative considered: use “Request alpha access” as the hero button. It is procedurally exact but
describes Podbay's gate instead of the visitor's desired action. The page retains “Private alpha”
beside the action so the click's destination is not surprising.

### 4. Use an architectural visual language, not a domestic one

The page uses a dark technical canvas, subtle grid, warm status accent, bounded “rooms” inside a
workspace frame, and a blue CTA. Warmth makes the home metaphor felt; precise labels and system
status keep it credible. Motion is limited to a subtle live indicator and entrance emphasis and is
removed under `prefers-reduced-motion`.

### 5. Give each section one psychological job

- **Hero:** relevance and desired action.
- **Under one roof:** ability; name the four capabilities.
- **One request, running system:** effort reduction; show the operating loop.
- **Start with the computer:** differentiation; contrast one capable workspace with assembly across
  multiple services without attacking named vendors.
- **Ownership/trust:** anxiety reduction; own subscription, official CLI, terminal/filesystem,
  owner-controlled external actions.
- **Closing CTA:** action after objections have been answered.

### 6. Keep preview traffic structurally outside measurement

`/preview/landing/agent-home` renders the server composition directly, uses ordinary Next links
rather than instrumented experiment links, emits `noindex`, and canonicalizes to `/`. It does not
extend `LANDING_VARIANTS`, assignment cookies, event allowlists, or experiment reports.

A later test should compare the winner of the current experiment with `agent-home` under a new
identifier. It should not turn the current test into a low-power three-way allocation.

## Risks / Trade-offs

- **“Home” sounds sentimental or vague** → Put Postgres, recurring work, project context, and the
  live URL directly beneath the headline and prove them in the adjacent visual.
- **The proof looks like a production deployment claim** → Use “live URL” and “running” rather than
  “deployed,” label the URL owner-only, and label the walkthrough simulated.
- **In-pod Postgres is read as a Neon/Supabase replacement** → Describe it as local to the workspace
  and state that external infrastructure remains available when the project needs it.
- **Scheduling appears universal** → Describe a shipped prepared scheduling capability and avoid
  saying every environment automatically has a configured schedule.
- **A long page lowers CTA visibility** → Keep the hero CTA above the fold, allow a secondary anchor,
  and repeat one CTA after the trust section.
- **Concurrent repository work conflicts at integration time** → Keep all work on the isolated
  worktree branch, avoid touching shared files beyond the landing surface, then rebase onto the
  integration branch and resolve only committed diffs.

## Migration Plan

1. Add the isolated component, styles, preview route, and tests on the dedicated branch.
2. Verify typecheck/tests, production build, desktop/mobile screenshots, keyboard focus, and reduced
   motion in the worktree.
3. Rebase the branch onto the target integration branch after the other agent has committed its
   work; rerun verification.
4. Merge or cherry-pick the resulting commit. The live root remains unchanged, so rollback is
   removal of the preview route and its isolated files.

## Open Questions

- When the current positioning experiment finishes, should `agent-home` be tested against the
  winner as a complete bundle or should its headline first be tested on the winning layout?
- Before a measured launch, should recurring work be generalized beyond the prepared operations
  environment so the capability can be stated without qualification?
