## 1. Auth library: email+password in OSS

- [x] 1.1 Enable better-auth's `emailAndPassword` plugin in `createAuth()` (`packages/auth/src/index.ts`).
      Keep GitHub as-is for cloud; email+password is additive. No schema change (the `account.password`
      column exists).
- [x] 1.2 Relax `authConfigured()` / `isAuthConfigured` (`apps/web/lib/auth.ts`, `@podbay/auth`): in the
      OSS edition, "configured" = `DATABASE_URL` + `BETTER_AUTH_SECRET` (no GitHub creds required). Cloud
      path unchanged.
- [x] 1.3 Add an `ownerExists()` / `hasOwnerCredential()` helper (does an `account` row with a password
      exist for the owner) used to switch setup vs login.

## 2. getCurrentUser: stop bypassing in OSS

- [x] 2.1 Remove the `LOCAL_USER` short-circuit in `getCurrentUser()` (`apps/web/lib/session.ts`); in OSS
      consult the better-auth session like cloud, mapping the owner row → `CurrentUser`.
- [x] 2.2 Preserve single-owner: the owner id stays stable (`local` on existing installs) so pods keep
      their `owner_id`. Ensure `requireApprovedUser()` passes for the owner (approved) and admin stays
      closed.
- [x] 2.3 Update the OSS `/` redirect + any place that assumed an always-present user
      (`app/page.tsx`, dashboard layout) to send unauthenticated OSS requests to sign-in.

## 3. First-run owner setup + sign-in UI

- [x] 3.1 `setupOwner` server action: guard "no owner yet" (re-check inside the action), create the owner
      via better-auth sign-up (attach credential to the existing `local` user id on an existing install;
      fresh id on a new install), sign in. Refuse if an owner already exists.
- [x] 3.2 Sign-in page (`apps/web/app/signin`, `components/signin-form.tsx`): in OSS render **Setup mode**
      when no owner credential exists (email pre-filled from `PODBAY_AUTH_EMAIL` default `owner@localhost`,
      password field, **Generate strong password** button using a client CSPRNG shown once), else **Login
      mode** (email+password). Cloud keeps the GitHub button.
- [x] 3.3 User menu / sign-out: show the owner; confirm `authClient.signOut()` clears the session and
      returns to sign-in.

## 4. Env + install plumbing

- [x] 4.1 `selfhost/start.sh`: generate+persist `BETTER_AUTH_SECRET` (randomBytes(32) base64, atomic
      hard-link to `/data/auth.secret`, explicit env wins) and export to `web` + `serve`. Mirror the
      existing `PODBAY_CRED_KEY` block.
- [x] 4.2 Optional pre-seed: on boot, if `PODBAY_AUTH_PASSWORD` is set and no owner exists, create the
      owner with it (so setup never shows). `PODBAY_AUTH_EMAIL` optional. Idempotent.
- [x] 4.3 `selfhost/compose.yaml` `x-app-env`: pass `BETTER_AUTH_SECRET`, `PODBAY_AUTH_PASSWORD`,
      `PODBAY_AUTH_EMAIL` to `web` + `serve`. Confirm same-origin cookie via the Caddy `proxy`.

## 5. Terminal coverage (REAL gap — serve currently bypasses)

- [x] 5.1 `packages/selfhost/podbay.mjs` `serve()` currently does `authenticate: async () => OWNER` —
      it authenticates EVERY terminal WS as the owner with no session check. Replace with real session
      validation: build a better-auth instance from the shared env and `authenticate: async (req) =>
      getSessionUserId(auth, headersFrom(req))` (null ⇒ refused).
- [x] 5.2 Owner id is no longer a hardcoded `"local"` in the served path: resolve the single owner id
      from the DB (the one credentialed user) so `serve`'s provision/reconcile loop and pod ownership
      use the real owner id. Keep the localhost one-shot CLI verbs on the fixed local owner.
- [ ] 5.3 Confirm an authenticated owner's terminal still connects end-to-end; an unauthenticated WS is
      refused.

## 6. Docs + verification

- [x] 6.1 `selfhost/README.md`: replace the "add basic_auth" note with the built-in gate; document
      first-run setup, the **Generate password** option, `PODBAY_AUTH_PASSWORD` pre-seed for public VPS,
      and password-recovery (re-seed / re-open setup via a documented `compose run`).
- [x] 6.2 Build + typecheck (web, auth); unit-test `ownerExists`/setup-guard logic and the
      `authConfigured` OSS relaxation.
- [ ] 6.3 Live check on a Docker host: fresh install → setup screen → create owner → dashboard + terminal
      reachable; unauthenticated request → redirected/refused; restart → still logged in (secret
      persisted); pre-seed via env → no setup screen. (Needs Docker — owner-run, like sizing 5.3.)
- [ ] 6.4 Apply the `self-host` spec delta (`openspec archive`) once shipped + live-verified.
