## Context

Sign-in is open (better-auth + GitHub). The alpha is invite-only, so product access must be gated
by approval, not just authentication. Decided (2026-07-09): admin page only — no email/webhook
notifications. This closes the open door before Fly provisioning goes live.

## Goals / Non-Goals

**Goals:**
- A persisted `approved` flag; access = approved OR admin OR pre-approved.
- Gate `/dashboard`, `/new`, `/pods/[slug]`; pending users see a "you're on the list" page.
- An admin page to approve/revoke, restricted to admin emails.

**Non-Goals:**
- Email notifications / approve-by-email links (admin page only).
- Billing/plans, team access, quotas/rate limits.

## Decisions

- **`approved` column on the existing `user` table**, not a separate table. better-auth ignores
  columns it doesn't manage, and a `NOT NULL DEFAULT false` covers its inserts, so no better-auth
  config change is needed; the gate reads the flag directly via Drizzle. _Alternative:_ a separate
  `access` table — more joins for no benefit at this scale.
- **Access = flag OR admin-email OR pre-approve-email.** Admins and known testers are allowed
  without a DB write, via `ADMIN_EMAILS` / `PREAPPROVE_EMAILS` env. The persisted flag is for
  everyone approved through the admin page. Pure, testable rule function.
- **Admin identity by email, from `ADMIN_EMAILS`.** Simple, no separate role system; the
  authenticated user's email (from the session) is checked against the list. _Alternative:_ a
  `role` column — overkill for one admin now.
- **`requireApprovedUser()` wraps `requireUser()`** → redirect to `/pending` when not allowed.
  Product pages swap `requireUser` → `requireApprovedUser`. `/admin` uses `requireAdmin()`.
- **Sign-in stays the one door.** The landing email waitlist remains as low-friction interest
  capture, but is no longer the gate; the gate is approval. (Repointing the landing CTA to "Sign
  in to request access" is a later copy tweak, out of scope here.)
- **Server actions for approve/revoke**, admin-checked, `revalidatePath('/admin')`. Same
  server-only, no-public-API pattern as the dashboard.

## Risks / Trade-offs

- **Admin page/gate need auth + DB** → test the pure rule function + the migration on pglite; the
  UI/gate path is a manual check (needs a session), consistent with prior UI changes.
- **Locking yourself out** → `ADMIN_EMAILS` is env-based and always-allowed, independent of the
  `approved` flag, so an admin can always reach `/admin` even before approving anyone. Set it
  before deploy.
- **better-auth insert vs new column** → the column has a DB default, so better-auth's user
  inserts (which don't mention it) still succeed. Verified by the migration test + a signup path
  check.
- **Race**: a user approved mid-session sees access on the next request (server components read
  fresh each navigation) — acceptable.

## Migration Plan

Add `user.approved` (default false), generate + commit the migration, apply to Neon. Set
`ADMIN_EMAILS` (and optional `PREAPPROVE_EMAILS`) as Fly secrets, then deploy. Rollback = revert +
drop column; open sign-up returns (only safe while provisioning is off).

## Open Questions

- Whether to also gate the terminal WebSocket at the gateway on approval (defense in depth). The
  gateway already checks pod ownership, and only approved users can create pods, so a pending user
  has no pod to reach — deferring extra gateway checks.
- Auto-approve-on-first-N-signups or keep fully manual. Manual for now.
