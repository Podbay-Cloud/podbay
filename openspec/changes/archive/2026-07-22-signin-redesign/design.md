## Context

`/signin` currently renders a server page containing a client `SignInForm` inside the global
`.center` and `.card.auth` styles. The card is fixed at 340px, contains only the wordmark, one
15px sentence, and a full-width button, and has no page-specific responsive composition or OAuth
failure state. The same global auth styles are also used by pending and error surfaces, so changing
them directly would expand the visual scope beyond sign-in.

The authentication contract is already established: better-auth starts GitHub OAuth, creates or
resolves the Podbay account, and returns to a validated internal `next` destination. Access control
then sends approved users into the product and unapproved users to the pending page. This change
must improve the entry experience without altering that flow. GitHub authentication identifies the
Podbay user only; Claude/Codex and repository authentication remain separate concerns.

## Goals / Non-Goals

**Goals:**

- Give `/signin` a substantial, professional single-panel layout that continues the visual quality
  of the new landing page while keeping authentication as the single primary action.
- Explain private-alpha access clearly for both first-time and returning visitors.
- Preserve and harden callback handling, add recoverable OAuth initiation states, and keep the
  interaction accessible from keyboard and phone.
- Keep the implementation isolated so pending, error, dashboard, and legacy global styles do not
  change accidentally.

**Non-Goals:**

- Changing GitHub OAuth, better-auth, sessions, approval rules, or pending behavior.
- Adding authentication providers or collecting additional account information.
- Turning sign-in into another landing page, adding multiple feature pitches, or adding animation.
- Redesigning other auth-adjacent pages or establishing a new application-wide component system.
- Authenticating model CLIs, repository access, or AI subscriptions through the GitHub action.

## Decisions

### 1. Use one substantial bounded auth surface on desktop

Render a centered shell approximately 680px wide with a stable desktop minimum height near 650px.
Inside it, keep a readable content column around 460px, generous padding, and one dominant OAuth
action. The surface uses an 8px radius, restrained border, and quiet background separation.

This makes the screen feel intentional without stretching the existing sparse card or filling the
page with repeated marketing. Alternative considered: increase `.card.auth` to 500px. Rejected
because it preserves the empty-page problem and creates unused space inside the card. Alternative
considered: add a contextual preview panel. Rejected during review because it competes with the
authentication task and makes a simple access flow visually heavier than needed.

### 2. Collapse to authentication-first content on narrow viewports

At phone sizes, remove the outer card treatment and let the sign-in panel fill the viewport while
retaining the wordmark, heading, access explanation, action, identity note, and back link. Do not
reduce primary body copy below 16px or the OAuth action below 48px high.

### 3. Keep the server/client boundary and use scoped styles

Keep destination resolution and the static page composition in `app/signin/page.tsx`. Keep OAuth
interaction state in the existing client `SignInForm`. Add `app/signin/signin.module.css` and import
that module from both components instead of modifying `.center`, `.card.auth`, or `.gh`, which are
still used by other surfaces.

Alternative considered: expand the landing CSS module into shared auth styles. Rejected because it
couples unrelated routes and turns this narrow change into a premature site-wide design system.

### 4. Use task-specific copy rather than another product pitch

The panel uses **"Private alpha"**, **"Sign in to Podbay"**, and explains that GitHub is used to
request access or return to existing projects. A short note separates Podbay account identity from
repository and AI-subscription access.

Do not add the landing's marketplace, no-markup, persistence, or catalog claims again. The sign-in
screen needs enough value context to reduce abandonment, but every additional pitch weakens the
single action.

### 5. Make OAuth initiation a semantic, recoverable form action

Wrap the action in a form and handle `onSubmit` so keyboard submission works naturally. While
`authClient.signIn.social` is initiating navigation, set an explicit busy label, set
`aria-busy`, and disable repeat submission. Handle both rejected promises and returned error
results; on failure, restore the idle action and render a concise message in a polite status region.

Alternative considered: keep the current click-only button and disabled state. Rejected because it
has no semantic form behavior and can leave the interface stuck on an initiation failure.

### 6. Centralize and harden internal callback resolution

Extract a small pure resolver used by the server page. Accept only a single-slash local path and
fall back to `/dashboard` for missing, external, protocol-relative, or malformed values. Pass the
resolved path unchanged to better-auth as `callbackURL`. Add unit cases for normal nested paths,
queries, `https://...`, `//...`, and malformed input.

The current `startsWith("/")` check is insufficient because protocol-relative destinations also
start with `/`. This hardening changes no intended callback behavior.

### 7. Verify behavior at the auth boundary and responsive surface

Add focused unit coverage for destination resolution and component-level action failure where the
existing test setup allows it. Extend the access E2E suite to verify the page heading, GitHub action,
back navigation, internal callback preservation, keyboard focus, and absence of horizontal overflow
at 320px. Inspect desktop and mobile screenshots before completing the change.

## Risks / Trade-offs

- **[The larger panel still feels sparse]** → Use deliberate vertical rhythm, clear alpha/access
  context, and a concrete post-authentication explanation rather than decorative filler.
- **[The page overstates private-alpha access]** → Say "request access," preserve the pending
  explanation, and avoid immediate-access language.
- **[OAuth initiation failures vary by better-auth response shape]** → Cover both returned errors
  and thrown failures, restore the action state in either case, and test the adapter boundary.
- **[Scoped auth styling drifts from the rest of the product]** → Reuse the existing font, Podbay
  mark, and the landing's restrained colors and dimensions without importing its CSS module.

## Migration Plan

1. Add the scoped sign-in layout, pure callback resolver, and OAuth error handling without changing
   better-auth configuration or access rules.
2. Add automated callback, access-flow, keyboard, and 320px overflow coverage.
3. Inspect desktop and mobile screenshots, including redirecting and failure states.
4. Deploy with the existing `/signin` route and OAuth callback unchanged. Roll back by reverting the
   sign-in page, form, scoped styles/assets, and focused tests; no data or API migration is needed.

## Open Questions

None.
