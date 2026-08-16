## Why

GitHub sign-in is live, so *anyone* can create a Podbay account — harmless while provisioning is
off, but the moment Fly is wired, open sign-up means strangers can burn compute and put their
subscription auth in our pods. The product is positioned as an invite-only alpha, but nothing
enforces it: account creation and product access are the same open door. This change makes
**sign-in = request access** and gates the product behind approval, with a simple admin page to
approve people (no email infra).

## What Changes

- **`approved` flag on users** (`@podbay/db`, default false) + migration; approval is persisted.
- **Access helper**: a user is allowed if `approved` OR their email is in the **admin list** OR the
  **pre-approve allowlist** — so admins and known testers are in instantly without flipping a flag.
- **Gate the product**: `/dashboard`, `/new`, `/pods/[slug]` require an *approved* user;
  unapproved signed-in users see a **"You're on the list"** pending page instead.
- **Admin page** (`/admin`, restricted to admin emails): list users (pending first) with one-click
  **Approve / Revoke**, via owner-checked server actions.
- **Telegram signup alert**: a better-auth user-create hook pings a Telegram bot ("🔔 new signup:
  …") so you know someone's waiting; you approve on the admin page. No-op if unconfigured.
- **Landing → one door**: replace the email waitlist form with a "Continue with GitHub" call to
  action (sign-in = request access), and add a Sign in affordance. Provisioning is the next step,
  so pushing sign-in is now the right funnel.
- Config: `ADMIN_EMAILS`, optional `PREAPPROVE_EMAILS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  (Fly secrets).
- Tests: the pure access logic (`isAllowed` / `isAdmin` / `isPreapproved`) and the migration
  applying on pglite; the admin UI, gated pages, and Telegram send are documented manual checks.

## Capabilities

### New Capabilities
- `access-control`: invite-only gating — the approval flag, the allow rules (admin +
  pre-approve), the product gate + pending state, and the admin approval page.

### Modified Capabilities
<!-- auth schema gains an `approved` column (additive; better-auth ignores extra columns, the DB
     default covers its inserts) — noted in design, no delta spec. -->

## Impact

- `@podbay/db`: `user.approved` column + migration (applied to Neon).
- `apps/web`: `lib/access.ts` (rules + `requireApprovedUser`/`requireAdmin`), `/pending` page,
  `/admin` page + approve/revoke actions; `/dashboard`, `/new`, `/pods/[slug]` switch to
  `requireApprovedUser`.
- Set `ADMIN_EMAILS` (you), optional `PREAPPROVE_EMAILS`, and `TELEGRAM_BOT_TOKEN` /
  `TELEGRAM_CHAT_ID` as Fly secrets.
- The landing waitlist form is removed (replaced by sign-in); the `/api/waitlist` route can stay
  dormant. The real gate is approval; the Telegram ping is awareness.
- Non-goals (explicit): approve-by-email links (admin page + Telegram alert only); self-serve
  billing/plans; team-level access; rate limits/quotas.
