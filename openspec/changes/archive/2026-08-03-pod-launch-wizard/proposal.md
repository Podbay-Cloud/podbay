## Why

Launching a pod is one dense screen today (`launch-configure.tsx`) — name, size, secrets, GitHub repo,
and agent picker all at once — and the moments *around* launch are underserved:

- **No guidance.** Everything is on one form; new users don't know what matters or in what order.
- **GitHub-on-an-existing-pod only authorizes.** `GithubConnect` sets the token and stops — no repo
  picker, and nothing lands in the pod.
- **After create, nothing explains how to connect** (Claude mobile/desktop app, web, or the Admin
  terminal for advanced use).
- **"Continue in Claude" opens a new browser tab** on desktop instead of the desktop app (Safari +
  Chrome); mobile already works via universal links.
- **Secrets are buried in a modal.** The `pod-secrets` system is fully built (encrypted `pod_secrets`
  → `/etc/podbay/secrets.env`; the agent can `podbay secrets request KEY "why"`), but there's no
  first-class place for it and no way to paste a `.env` to set many keys at once.

This change makes launch a **guided, one-thing-at-a-time wizard** and fills those gaps — almost
entirely by **re-composing components that already exist** (`LaunchConfigure` fields, `SecretsPanel`,
`GithubRepoField`/`RepoPicker`, `WizardProgress`). Net-new surface is deliberately tiny.

## Decisions

- **Adaptive wizard + a final Review step.** One screen per real choice; skip steps the env doesn't
  need (no GitHub step unless the env is BYO-repo; no Agent step unless it offers >1 agent); end on a
  read-only Review & Launch summary. The `launchPod(env, {...})` payload and the post-create
  DB-derived phases (creating → login → agent → ready) are unchanged.
- **The wizard survives a page reload.** Step *and* entered fields restore on refresh via a
  `sessionStorage` draft keyed by env (`podbay:launch-draft:<env>`), cleared on successful launch —
  survives a refresh in the same tab, dies when the tab closes. (`sessionStorage`, not `localStorage`,
  because a launch draft is transient and may hold just-typed secret values.)
- **One pod = one repo.** Code always lives at `~/work`, never `~/work/<repo>` — per-pod path drift
  would confuse the agent across pods. A user who wants multiple projects uses a monorepo. Adding
  GitHub to an existing pod therefore clones into `~/work` **only when it is empty**; a non-empty
  `~/work` is refused, never overwritten (upholding "never overwrite the user's work").
- **Post-create walkthrough = anchored coach-marks.** A light popover with a protruding arrow pointing
  at the element being explained (Next → Next → Done), built on the shadcn/Base-UI `popover` primitive
  — not centered modal cards, and not a third-party tour library.
- **Walkthrough "seen" = a per-pod DB flag** (`pods.walkthroughSeenAt`), so it shows exactly once and
  is durable across devices — consistent with the app's server-derived-state model.
- **Continue-in-Claude stays a web-tab open (researched 2026-08-03).** There is no documented Claude
  desktop URL scheme, and a browser click can't reliably reach a desktop app; guessing a scheme risks a
  browser error dialog (Safari). So the button keeps opening the web session in a new tab — the correct
  cross-platform behavior — and the **walkthrough tells the owner they can open the same session in
  their Claude desktop app**. On mobile the OS already routes the web URL to the app.

## What Changes

- **web (launch)** — `launch-configure.tsx` becomes an adaptive stepper (Basics → GitHub → Settings →
  Review) with a sessionStorage-backed draft and an inline sub-step indicator. Same `launchPod`
  payload; post-create phases untouched.
- **web (cockpit)** — `SecretsPanel` becomes a first-class **Secrets tab** (drop the modal +
  `SettingRow`); the add-GitHub flow gains a **repo picker + clone**; a post-create **connect
  walkthrough** anchored to the connect controls, naming both the web and desktop-app ways to open the
  session. **Continue-in-Claude** stays a reliable web-tab open (no undocumented desktop scheme).
- **web (util/primitive)** — `lib/env-paste.ts` (parse a pasted `.env` blob → `{key,value}[]`); add the
  shadcn/**Base-UI `popover`** primitive (positioner + arrow) for the walkthrough.
- **pod-agent** — `POST /clone-repo {repo}`: clone into `~/work` as dev via the existing gh credential
  store (never token-in-URL) **iff `~/work` is empty**; a non-empty `~/work` is refused.
- **db** — `pods.walkthroughSeenAt timestamp` + a drizzle migration.

## Deferred

- **Opening the Claude desktop app from the button** — not achievable from a browser click without a
  documented URL scheme (none exists). Revisit only if Anthropic publishes one; the walkthrough covers
  the desktop-app path as guidance in the meantime.
- An opt-out for persisting typed **secret values** in the sessionStorage draft (default persists them
  so a reload restores everything; opt-out would exclude only `values`).
- An explicit **"replace `~/work`"** clone path (behind a confirm) — out of scope; the default of
  refusing a non-empty `~/work` protects existing work.
- Applying the deep-link helper to the sibling Claude-web links (`pod-cockpit.tsx`, other
  `agent-cards.tsx` anchors) — consistency pass, after Phase E lands.
