## 1. Experiment Foundation

- [x] 1.1 Add versioned server-only experiment configuration with semantic variants, enabled/fallback state, equal allocation, cookie settings, crawler behavior, and allowlisted event names.
- [x] 1.2 Add Drizzle assignment/event tables, constraints, indexes, exports, and a migration; verify the migration against the project's test Postgres path.
- [x] 1.3 Add Drizzle experiment runtime and immutable admin-audit tables with typed status/pin fields, constraints, exports, and migration coverage.
- [x] 1.4 Implement and unit-test privacy-minimal assignment/event persistence helpers, including exposure deduplication, bounded campaign fields, allowlists, and absent-attribution no-ops.

## 2. Assignment And Preview Slice

- [x] 2.1 Extract the current landing into an `outcomes` composition, preserving its layout, interactions, session-aware CTA, responsive behavior, and analytics identifiers while synchronizing pre-freeze cards and support claims with the real marketplace.
- [x] 2.2 Extend middleware with first-visit assignment, repeat assignment, invalid-cookie recovery, deterministic crawler handling, and private request headers while preserving canonical-host redirects.
- [x] 2.3 Make `/` render the assigned variant on the server with no redirect or client content swap, initially pinning both configured allocations to the outcomes composition for A/A validation.
- [x] 2.4 Add `/preview/landing/outcomes` and `/preview/landing/agent-computer` with forced rendering, no assignment mutation, no experiment recording, `noindex`, and `/` canonical metadata.
- [x] 2.5 Add focused tests for equal/stable assignment boundaries, cookies, crawler exclusion, authenticated eligibility, preview isolation, canonical metadata, and first-response rendering.

## 3. Measured Acquisition Slice

- [x] 3.1 Add a same-origin experiment event endpoint that derives attribution from server cookies, validates allowlisted payloads, omits raw IP/free-form metadata, and persists idempotently.
- [x] 3.2 Replace or extend the browser-only landing adapter with non-blocking exposure, CTA, control-example, and playbook-selection delivery using beacon/keepalive behavior and safe failure handling.
- [x] 3.3 Record one viewable exposure per eligible visitor/experiment while excluding previews, crawlers, and primary-analysis-ineligible authenticated visits.
- [x] 3.4 Add endpoint, adapter, duplicate-exposure, invalid-payload, unavailable-backend, and navigation-preservation tests.

## 4. Downstream Attribution Slice

- [x] 4.1 Add an idempotent server helper that links the anonymous assignment to the user and records `signin_completed` on the first authenticated page after sign-in for both GitHub and magic-link flows.
- [x] 4.2 Record `pod_created` only after authoritative launch success and cover attributed, unattributed, duplicate, and analytics-failure paths.
- [x] 4.3 Record `agent_connected` when the durable `authedAt` milestone first transitions and record `first_project_opened` on the first owner cockpit/project visit, both idempotently.
- [x] 4.4 Add an admin-safe query or script that reports per-variant eligible visitors, exposures, CTA, sign-in, pod creation, agent connection, and first project open without exposing anonymous identifiers.
- [x] 4.5 Add integration tests proving attribution survives the auth round trip and remains linked through the activation funnel.

## 5. Admin Experiment Console

- [x] 5.1 Add Experiments to the existing admin navigation and implement `/admin/experiments` with definition/runtime status, allocation, dates, eligible sample, exposure, and primary-outcome summaries.
- [x] 5.2 Implement `/admin/experiments/[id]` with read-only configuration, per-variant funnel counts/rates, bounded acquisition breakdowns, assignment/ingestion health, sanitized recent events, and low-data states.
- [x] 5.3 Implement confirmed, admin-gated Stop and Pin variant actions with server-side declared-variant validation, idempotent runtime transitions, and immutable audit history.
- [x] 5.4 Add admin query/action/access-control tests covering aggregation accuracy, empty data, identifier masking, invalid pins, confirmation-backed transitions, and audit rows.

## 6. Agent-Computer Treatment Slice

- [x] 6.1 Implement the treatment's unframed, product-led hero with the "always-on computer for your coding agent" narrative, session-aware CTA, and above-fold supported-subscription/no-token-markup distinction.
- [x] 6.2 Build product-authentic continuity proof showing production-ready native remote control, browser terminal, and live preview behavior with explicitly simulated project data; complete an asset privacy review.
- [x] 6.3 Implement the off-device benefits band covering 24/7 continuity, remote CPU/RAM/disk, and project-scoped isolation without claiming complete malicious-skill or egress protection.
- [x] 6.4 Implement the readiness-gated real playbook section for Bring Your Project, Ask Your Docs, First 10 Customers, and Morning Ops Robot, including what is prebuilt, included vetted skills, customization, and separate API-key disclosure where applicable.
- [x] 6.5 Implement ownership/trust proof and the closing CTA using precise official-CLI, full-workspace, project-secret, and client-support claims.
- [x] 6.6 Add treatment-specific styles and interactions with stable media dimensions, visible focus, meaningful alternative text, reduced-motion behavior, and coherent layouts from 320px through wide desktop.

## 7. Claim And Experience Verification

- [x] 7.1 Complete a release claim checklist against current Incus 24/7 behavior, Claude remote control, Codex production parity, browser/native terminal support, security/egress state, and each playbook's kill-test or dogfood status.
- [x] 7.2 Remove, qualify, omit, or block every treatment claim/playbook that fails its release gate; specifically keep Morning Ops Robot out of launch-ready proof until image rebuild and multi-day dogfood pass.
- [x] 7.3 Add stable canonical root metadata and social previews that remain truthful independent of assignment and clearly describe the supported bring-your-own-subscription model.
- [x] 7.4 Run unit tests, web tests, production build, and Playwright checks for both variants at desktop, 320px mobile, keyboard-only, and reduced-motion settings.
- [x] 7.5 Inspect Playwright screenshots for text overflow, overlap, visual hierarchy, real asset rendering, and first-viewport visibility of the next section; fix all discovered issues before exposure.

## 8. Experiment Launch And Operations

- [~] 8.1 Run the production A/A validation and verify stable repeat assignment, approximate allocation, single exposures, preview/crawler exclusion, auth linkage, and every downstream event before enabling treatment traffic.
  - [x] Allocation: 66/54 across 120 fresh contexts (z=1.10, p≈0.27 — within variance for 50/50); **all 120 rendered the `outcomes` control**, confirming A/A.
  - [x] Stable repeat assignment: 10 jars × 3 visits, 0 drift.
  - [x] Assigned variant server-rendered in the initial response (no redirect, no client swap).
  - [x] Preview routes + 3 crawler UAs (Googlebot/Twitterbot/facebookexternalhit): 0 assignment cookies set.
  - [x] Invalid/corrupt cookie recovers to HTTP 200 without failing the request.
  - [x] Preview routes serve `noindex, nofollow` + canonical `https://podbay.cloud`.
  - [x] Ingestion contract: exposure `recorded` → repeat `duplicate` (dedup holds); unknown event, server-only event (`pod_created`) via the browser channel, and no-assignment POST all rejected 400.
  - [x] Admin console gates anon (307 → /signin).
  - [ ] **Auth linkage + downstream funnel (`signin_completed`, `pod_created`, `agent_connected`, `first_project_opened`) — NOT verified.** Requires a real signed-in account and a launched pod; no credentials available to the agent session. Owner must complete one signed-in run before 8.3.
  - [x] **Exposure-on-page-view — VERIFIED in a real browser 2026-07-28** (once this pod had Chromium from image `7569b02e18cb`). Loaded `https://podbay.cloud/` in a fresh Playwright context: exactly one `navigator.sendBeacon` to `/api/experiments/landing/events` on view, body `{"event":"landing_exposure",...}`, zero before load. Confirmed A/A too: cookie assigned `agent-computer` while the page rendered the `outcomes` control.
- [x] 8.2 Record the experiment's primary metric, activation metrics, guardrails, observation window, baseline conversion, and minimum qualified sample before reading A/B results. — `docs/runbooks/landing-positioning-experiment.md:11-17` (primary metric, activation metrics, guardrail, read rule "14 full days and 100 eligible exposures per variant", baseline from A/A, 90-day retention).
- [ ] 8.3 Enable equal `outcomes`/`agent-computer` allocation under `landing-positioning-2026-07` without modifying either narrative after measurement begins.
  - VERIFIED OPEN 2026-07-30: the run is `active` with 50/50 allocation and no pinned variant, but
    production has `PODBAY_LANDING_EXPERIMENT_MODE` UNSET, which the config resolves to **A/A**
    (`apps/web/lib/landing-experiment-config.ts:18`) — so `agent-computer` is not being served and the
    32 assignments collected since 2026-07-27 are A/A validation data, not an A/B result. Flipping the
    var to `ab` is the remaining action, and only after the A/A gate + baseline are complete.
- [x] 8.4 Document the admin Stop/Pin rollback procedure, event retention period, result query, and rule that material narrative changes require a new experiment identifier.
