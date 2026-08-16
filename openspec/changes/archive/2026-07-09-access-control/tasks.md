## 1. Schema & migration

- [x] 1.1 Add `approved` (boolean, not null, default false) to the `user` table in `@podbay/db`
- [x] 1.2 Generate + commit the migration; test it applies on pglite and default is false
- [x] 1.3 Apply the migration to Neon

## 2. Access rules (pure, testable)

- [x] 2.1 `apps/web/lib/access.ts`: `isAdmin(email)`, `isPreapproved(email)` (read `ADMIN_EMAILS` /
  `PREAPPROVE_EMAILS`), `isAllowed({ email, approved })` = approved || admin || preapproved
- [x] 2.2 Tests for the rule matrix (approved / admin / preapproved / none)

## 3. Gate

- [x] 3.1 `requireApprovedUser()` — requireUser + look up `approved` (Drizzle) + rules → redirect
  `/pending` if not allowed
- [x] 3.2 `requireAdmin()` — requireUser + `isAdmin` → redirect/deny otherwise
- [x] 3.3 Swap `requireUser` → `requireApprovedUser` in `/dashboard`, `/new`, `/pods/[slug]`
- [x] 3.4 `/pending` page: "You're on the list — we'll email you when you're in"

## 4. Admin page

- [x] 4.1 `/admin` (requireAdmin): list users (pending first) with email, name, approved, joined
- [x] 4.2 Server actions `approveUser(userId)` / `revokeUser(userId)` — admin-checked;
  `revalidatePath('/admin')`
- [x] 4.3 Client Approve/Revoke buttons

## 5. Telegram signup alert

- [x] 5.1 In `@podbay/auth` `createAuth`, add a better-auth `databaseHooks.user.create.after` that
  posts to Telegram `sendMessage` (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`); no-op if unset,
  never throws (best-effort, doesn't block signup)
- [x] 5.2 A small `notifySignup({ name, email })` helper; unit-test that it no-ops without config

## 6. Landing → sign-in

- [x] 6.1 Replace the waitlist form on the landing hero with a "Continue with GitHub" CTA → `/signin`
- [x] 6.2 Add a "Sign in" link in the landing nav; keep the `/api/waitlist` route dormant

## 7. Config & docs

- [x] 7.1 Document `ADMIN_EMAILS` / `PREAPPROVE_EMAILS` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
- [x] 7.2 Update docs/roadmap.md that access is invite-only (admin-approved) + Telegram alerts
