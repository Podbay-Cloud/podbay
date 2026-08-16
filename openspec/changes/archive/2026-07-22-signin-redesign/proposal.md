## Why

The current `/signin` page presents a 340px generic card in an otherwise empty viewport, which
feels visually unfinished and gives visitors too little context about private-alpha access. The
landing redesign now sets a materially higher visual and copy standard, so the authentication entry
point needs a focused, credible continuation of that experience before pre-alpha release.

## What Changes

- Replace the small centered auth card with a substantial, responsive single-panel sign-in surface
  that uses the Podbay visual system and keeps authentication as the only primary task.
- Keep the authentication action prominent in a generously sized sign-in panel, with concise copy
  explaining that GitHub is used both to request private-alpha access and to return to Podbay.
- Explain the post-authentication outcome without changing it: approved users continue to their
  requested product destination, while unapproved users enter the existing pending flow.
- Add a clear route back to the landing page plus appropriate loading, failure, keyboard-focus, and
  mobile states around the GitHub OAuth action.
- Preserve the validated same-origin `next` destination and existing better-auth GitHub callback.
- Treat GitHub OAuth as Podbay account authentication only. This change does not authenticate,
  proxy, pool, or modify Claude Code, Codex, or their subscription credentials.

## Capabilities

### New Capabilities

- `signin-experience`: Responsive sign-in presentation, access-context copy, GitHub action states,
  navigation, and accessibility behavior for the `/signin` entry point.

### Modified Capabilities

None. The existing `auth` and `access-control` requirements remain unchanged.

## Impact

- Affects `apps/web/app/signin/page.tsx`, `apps/web/components/signin-form.tsx`, and scoped sign-in
  styling/assets in `apps/web`.
- Extends focused web and end-to-end coverage for sign-in rendering, callback preservation, action
  states, keyboard access, and responsive overflow.
- Reuses the existing Podbay mark, font, and GitHub OAuth client; no new runtime dependency,
  authentication provider, API, database migration, or secret is required.

## Non-goals

- Changing GitHub OAuth, better-auth configuration, session persistence, approval rules, pending
  access, or the meaning of the `next` callback.
- Adding email/password, magic-link, passkey, or additional social-login methods.
- Redesigning the pending page, dashboard, landing page, global error surface, or authenticated app
  shell as part of this change.
- Adding testimonials, usage metrics, decorative animation, or a secondary marketing panel.
- Changing model authentication or making claims about Claude/Codex subscription handling on the
  sign-in page.
