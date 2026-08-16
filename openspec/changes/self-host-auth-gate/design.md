# Design — self-host auth gate

## Context

OSS auth today: `getCurrentUser()` (`apps/web/lib/session.ts`) short-circuits in `editionOss()` and
returns a hardcoded `LOCAL_USER` (seeding one `user` row `id:"local"` for the `pods.owner_id` FK).
Cloud auth is better-auth (`packages/auth/src/index.ts`) with GitHub OAuth, DB-backed `session`, a
signed `better-auth.session_token` cookie, and `getCurrentUser()` calling `getAuth().api.getSession()`.
Crucially, `serve` (the terminal daemon) already validates better-auth sessions via `getSessionUserId`
— so if OSS uses better-auth sessions, the terminal is gated with zero new gateway code.

Chosen approach (owner decisions): **reuse better-auth email+password**, with a **first-run setup that
can auto-generate** the password.

## Goals / non-goals

- **Goal**: no unauthenticated access to dashboard or terminal in OSS; safe to expose on a VPS.
- **Goal**: zero-config happy path — first boot generates the session secret; owner sets a password
  once (or generates one, or pre-seeds via env).
- **Non-goal**: multi-user / roles / invites. Still exactly one owner.
- **Non-goal**: GitHub OAuth in OSS (no app registration on a self-host box).
- **Non-goal**: rate-limiting / lockout tuning beyond better-auth defaults (note as follow-up).

## Key decisions

### 1. Enable better-auth email+password in OSS
Turn on better-auth's `emailAndPassword` plugin (the `account.password` column already exists). In OSS
we do NOT configure GitHub. `authConfigured()` (`apps/web/lib/auth.ts`) is relaxed: in OSS, "configured"
= `DATABASE_URL` + `BETTER_AUTH_SECRET` present (email/password needs no external provider). Cloud path
is unchanged (still needs GitHub creds).

### 2. `getCurrentUser()` stops bypassing in OSS
Remove the `LOCAL_USER` short-circuit. In OSS, `getCurrentUser()` consults the better-auth session like
cloud. The single-owner model is preserved by *how the owner is created* (one credential, see §4), not
by faking a user. The `id:"local"` seed is replaced by the real owner row better-auth creates on setup;
existing installs that already have `id:"local"` pods keep working because setup attaches the owner
credential to that same stable id (see §6 migration note).

### 3. Owner identity = a fixed email, single row
The owner signs in with an email. Default `owner@localhost` (overridable via `PODBAY_AUTH_EMAIL`), so the
UI can pre-fill it and the owner mostly just types a password. Exactly one owner row exists; setup
refuses to create a second.

### 4. First-run setup, and how it closes
`authConfigured()` is true, but "is there an owner credential yet?" is a separate check: does an
`account` row with a password exist for the owner?
- **No owner credential** → the sign-in page renders **Setup mode**: email (pre-filled) + password, with
  a **"Generate a strong password"** button (client-side CSPRNG, shown once to copy). Submit calls a
  `setupOwner` server action that: (a) re-checks no owner exists (guard against a race / double-submit),
  (b) creates the owner via better-auth sign-up (hashes the password), (c) signs them in.
- **Owner credential exists** → **Login mode** only; `setupOwner` hard-refuses ("owner already exists").
- **Pre-seed** via `PODBAY_AUTH_PASSWORD` (+ optional `PODBAY_AUTH_EMAIL`): on boot, `serve`/web ensures
  the owner exists with that password before serving, so Setup mode never shows and there is **no claim
  window** on a public VPS. Precedence: an explicit env password always wins; otherwise first-run setup.

The claim-window risk (public VPS, attacker reaches setup before owner) is mitigated two ways: the
README tells VPS users to either set `PODBAY_AUTH_PASSWORD` or complete setup immediately, and setup is
one-shot (first credential wins and closes the door).

### 5. `BETTER_AUTH_SECRET` — generate + persist on first boot
Sessions need a stable signing secret across restarts. Mirror `PODBAY_CRED_KEY` in `selfhost/start.sh`:
if `BETTER_AUTH_SECRET` is unset and the data volume is mounted, generate `randomBytes(32)` base64,
atomically hard-link to `/data/auth.secret`, export it to **both** `web` and `serve` (they must share it
to validate the same cookie). Explicit env value wins. This keeps the install zero-config.

### 6. Terminal / `serve` coverage — verify, don't rebuild
`serve` already calls `getSessionUserId` against the same DB `session` table + secret. Once web and
serve share `BETTER_AUTH_SECRET` and the cookie is same-origin (Caddy proxies both under one origin), an
unauthenticated WS is rejected already. Task 5 **verifies** this rather than assuming it; if a gap
exists (e.g. serve didn't enforce in OSS because there was never a session), close it there.

### 7. No schema change
Reuses `user` / `session` / `account` (the `password` column exists). New env only:
`PODBAY_AUTH_PASSWORD` (optional), `PODBAY_AUTH_EMAIL` (optional). Migration note: an existing OSS
install has a `user` row `id:"local"` and pods FK'd to it. Setup should attach the owner credential to
that SAME row (keep `id:"local"` as the owner id) so existing pods keep their owner — i.e. create the
credential account against the existing local user rather than a fresh id. New installs create the owner
fresh. This avoids orphaning pods.

## Risks / tradeoffs

- **Claim window** on a public VPS if the owner neither pre-seeds nor sets up promptly → mitigated by
  §4 (one-shot setup + README guidance + env pre-seed). Documented, not eliminated.
- **Lost password** → no email reset in OSS (no SMTP). Recovery = the owner resets via the data volume
  (a documented `compose run` that re-seeds from `PODBAY_AUTH_PASSWORD`, or clears the credential to
  re-open setup). Note in README; a polished reset flow is a follow-up.
- **better-auth email+password defaults** (min length, hashing) are inherited; we don't hand-roll. If a
  stronger policy is wanted later, it's a plugin config change, not a rewrite.
- **`getCurrentUser()` is hot** (called on every gated render/action) — the OSS branch now hits the
  session API like cloud; that's the same cost cloud already pays, acceptable.

## Migration / rollout

Ships in the OSS images (web + pod-app already rebuilt for sizing; this rides the next rebuild). On a
running install: `docker compose pull && up -d`; the first dashboard visit shows owner setup. Cloud is
untouched (the OSS branch is behind `editionOss()`; email+password plugin is enabled but cloud still
gates on GitHub via `authConfigured` + the sign-in UI).
