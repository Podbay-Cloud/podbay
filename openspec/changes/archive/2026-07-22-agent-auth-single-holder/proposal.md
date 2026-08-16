## Why

Shared-credential injection (the pre-signed-in one-click pitch) is **unsafe across concurrent
pods**: Claude Code rotates its refresh token on every refresh, so two pods running on the same
injected login rotate each other's tokens out — later/older pods go stale ("Login expired", or a
fall back to API-usage billing where **Remote Control doesn't work**). Verified live 2026-07-14:
launching several pods concurrently broke auth on the later ones. M1 (write-back on sleep), M2-lite
(drain-before-inject), and M3 (freshness guard) handle the SEQUENTIAL case; the concurrent case is
the remaining gap. Decision (vels, 2026-07-14): keep sharing, add **single-active-holder** — do NOT
switch to per-pod login (it kills the differentiator and may not even fix concurrency).

RC raises the stakes: the app-primary pivot ([entry-points-plan](../../../docs/entry-points-plan.md))
requires each pod to hold valid **subscription** OAuth, so auth must not silently rot.

## Decisions / design — FINALIZED 2026-07-14

Priority (vels): **once a pod is logged in it must NEVER be logged out** — regardless of sleep/wake,
other pods starting, or a mix of sleepy and 24/7 pods. "New pods don't require login" is *ideal* but
strictly secondary.

Physics: Claude rotates the refresh token on every refresh (confirmed), so **one grant shared by two
concurrently-existing pods → they log each other out.** Therefore the invariant:

> **One grant ↔ one pod for that pod's lifetime.** A grant is never shared across concurrently
> existing pods, so it is only ever rotated by its owner → never invalidated by another → never
> logged out.

Model:
- The **vault holds one "free" grant** (captured from a pod that has since been **destroyed**).
- **Launch/wake:** if the vault grant is *free* (its previous owner no longer exists) → inject it;
  the new pod becomes its owner (no login). If it's *checked out* (an existing pod — running OR
  sleeping — still owns it) → the new pod does its own `/login` (independent grant).
- **Ownership persists until the pod is DESTROYED** (not merely sleeping) — a sleeping owner still
  holds its grant (it resumes on wake and rotates its own copy). On destroy, capture the owner's
  latest creds back to the vault so the freed grant can seed the next new pod.
- Write-back to the vault is accepted **only from the current owner** of the vault grant.

Result: never-logged-out is absolute; the one-click "replace my pod" flow keeps no-login; each
*additional concurrent / 24-7* pod logs in exactly once, then never again.

## Linchpin to confirm (one clean test)

**Do two pods, each independently `/login`'d to the same account, both stay authed concurrently and
across sleep/wake?** Near-certain (Claude multi-device: phone app + pods coexist — vels has lived
it), but it's the assumption the whole model rests on. If it were FALSE (one grant per account), then
multiple concurrent authed pods are impossible on one account — a hard limit to surface. Acceptance
test: vels logs into two pods; we verify over time + a sleep/wake that neither gets logged out.

## What Changes

- **db/control-plane:** holder record per (user, agent); `credentialsForLaunch` skips injection when
  a live holder exists (other than this pod); `writeBackCredentials`/capture accepted only from the
  holder; holder cleared on sleep/destroy. Tests (concurrent launch skips inject; holder handoff on
  sleep; non-holder write-back rejected).
- **No web/pod-base change** required for the core; a later UI cue ("another pod holds your login —
  this one needs /login") is a follow-up.
