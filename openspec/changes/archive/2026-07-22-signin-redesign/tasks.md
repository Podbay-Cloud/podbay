## 1. Callback Safety

- [x] 1.1 Extract a pure sign-in callback resolver that accepts valid single-slash local paths and
  falls back to `/dashboard` for missing, external, protocol-relative, or malformed destinations.
- [x] 1.2 Add focused unit coverage for nested local paths and queries plus `https://`, `//`, and
  malformed callback inputs.

## 2. Responsive Sign-in Surface

- [x] 2.1 Replace the small global auth-card composition on `/signin` with a substantial scoped
  single-panel page containing Podbay identity and clear alpha context while preserving the
  server/client boundary.
- [x] 2.2 Build the full-height tablet and mobile layouts, removing the floating-card treatment on
  phones and verifying that primary text remains at least 16px and the action at
  least 48px high.
- [x] 2.3 Add sign-in-specific metadata, a clear landing-page return route, visible focus treatment,
  and truthful GitHub account-scope copy without changing global auth styles.

## 3. OAuth Interaction

- [x] 3.1 Convert the GitHub action to a semantic form submission that preserves the resolved
  callback, announces redirect progress, and blocks duplicate activation.
- [x] 3.2 Handle returned and thrown OAuth initiation failures with a readable status message,
  restored idle state, and a working retry path.
- [x] 3.3 Add focused interaction coverage for keyboard submission, busy state, failure recovery,
  and the callback passed to the existing better-auth GitHub flow.

## 4. Verification

- [x] 4.1 Extend access E2E coverage for sign-in heading/action, back navigation, safe callback
  behavior, keyboard focus, and absence of horizontal overflow at 320px.
- [x] 4.2 Run web unit tests, the relevant access E2E flow, type checking, and the production build;
  resolve all failures introduced by the change.
- [ ] 4.3 Inspect desktop, tablet, 390px, and 320px screenshots for hierarchy, text size, focus,
  error state, and overlap; confirm the sign-in action stays above the fold on
  short phone viewports.
- [x] 4.4 Review the final page against GitHub logo policy, private-alpha truth, and the boundary
  between Podbay account sign-in, repository access, and Claude/Codex authentication.
