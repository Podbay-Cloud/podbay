## Context

The current landing is one server-rendered page with a small client component for rotating examples.
Its analytics adapter dispatches a browser `CustomEvent`, but no consumer persists events. The page
also has a spec-level commitment to one outcome-led headline and a conceptual six-starter catalog.

Podbay now runs Incus-backed pods 24/7 and has four concrete playbook candidates: Bring Your
Project, Ask Your Docs, First 10 Customers, and Morning Ops Robot. The strategic question is whether
visitors respond better to those outcomes or to the more literal category, "an always-on computer
for your coding agent." The experiment must preserve the current page as a genuine control while
measuring product activation deeply enough to distinguish qualified demand from curious clicks.

The implementation crosses Next middleware, server rendering, authentication attribution, Drizzle
persistence, pod lifecycle milestones, SEO metadata, and two responsive landing experiences. It
must keep model authentication inside unmodified official CLIs and keep public claims inside the
actual Claude, Codex, network, and environment readiness boundaries.

## Goals / Non-Goals

**Goals:**

- Assign eligible visitors evenly and persistently before the first render at the canonical `/`.
- Preserve the current page as the `outcomes` control and build a distinct `agent-computer`
  treatment from production-ready proof.
- Provide deterministic semantic previews that cannot contaminate the experiment.
- Persist exposure and conversion attribution from anonymous visit through agent activation.
- Make experiment delivery non-blocking and privacy-minimal.
- Keep one canonical, crawlable landing identity while the human-facing body is tested.

**Non-Goals:**

- Selecting a third-party analytics platform or building a general-purpose experimentation SaaS.
- Inferring which individual treatment element caused a result.
- Altering access approval, subscription authentication, pricing, or pod provisioning behavior.
- Publishing Codex, terminal, security, egress, or playbook claims before their product gates pass.
- Turning conceptual screenshots into evidence of customer use.

## Decisions

### 1. Keep `/` canonical and render the assigned variant on the server

`/` remains the public URL. Middleware reads a versioned assignment cookie and, for an unassigned
human request, chooses `outcomes` or `agent-computer` using an equal allocation. It forwards the
chosen variant and opaque visitor id to the initial request through private request headers while
setting HttpOnly first-party cookies on the response. The root server page renders the selected
component immediately.

The experiment configuration is a typed server-only object containing the experiment id, enabled
state, allocation, allowed variants, cookie names, and canonical crawler/fallback variant. Cookies
use `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`, and a bounded lifetime. Invalid or stale values
are replaced. Assignment does not depend on user-controlled query parameters.

Alternative considered: redirect `/` to a variant URL. Rejected because it exposes assignment,
adds latency, splits the canonical URL, and makes campaign and crawler behavior harder to reason
about.

Alternative considered: choose the variant in a client component. Rejected because it flashes the
wrong page, weakens accessibility and metadata, and can log exposure to content the visitor never
actually saw.

### 2. Use semantic preview routes outside the assignment path

`/preview/landing/outcomes` and `/preview/landing/agent-computer` directly render the requested
component. They neither read nor write assignment for display, do not mount experiment recording,
emit `noindex`, and canonicalize to `/`. The implementation may require an authenticated admin in
production, but route correctness must not depend on that optional gate.

Alternative considered: `?variant=v1` and `?variant=v2`. Rejected because query links are easily
shared as campaign URLs, can mutate attribution accidentally, and preserve labels that become
meaningless after another iteration.

### 3. Separate variant composition from assignment and shared session work

The existing landing page moves into an `OutcomesLanding` server composition. Before the
experiment narrative freeze, its demand cards are synchronized to the real playbook catalog and
unsupported client/isolation claims are qualified; its outcome-led layout and interaction model
remain the control. A new
`AgentComputerLanding` composition receives the same minimal shared inputs: session-aware CTA
destination/label and catalog availability. The root and preview routes call a shared render helper
instead of duplicating session resolution. Variant-specific client behavior and CSS remain isolated
so treatment work does not alter control layout or timing.

The experiment identifier and variant are supplied explicitly to instrumented treatment/control
components. No component reads assignment from `window.location`.

### 4. Treat V2 as a positioning bundle with one narrative job per section

The treatment uses this sequence:

1. **Hero:** "An always-on computer for your coding agent," continuity after the laptop closes, a
   primary CTA, and an above-fold line that Podbay hosts the workspace while the visitor uses their
   supported existing subscription. The no-token-markup distinction can appear later in the page.
2. **Continuity proof:** one real visual story showing the same pod through supported native remote
   control, Podbay's browser terminal, and a live project/preview. The visual uses production
   captures or clearly labeled simulated data, not a generic conceptual SaaS screen.
3. **Why off-device:** remote CPU/RAM/disk, 24/7 availability, and a smaller project-scoped blast
   radius. Security is supporting proof, not the fear-led headline.
4. **Prepared playbooks:** actual launch-ready catalog entries explaining what is prebuilt, which
   vetted/pinned skills shape the work, and what remains customizable.
5. **Ownership and trust:** full workspace/terminal access, project-scoped secrets, unmodified
   official CLI, and precise boundaries.
6. **Closing CTA:** the same access action as the hero.

The hero is an unframed full-width composition with a real Podbay/product signal in the first
viewport, not a split marketing card. Its dimensions keep a hint of the next section visible on
mobile and desktop. Motion is optional, reduced-motion safe, and never required to understand the
continuity story.

Alternative considered: lead with malicious skills. Rejected because it makes the page defensive,
overweights a partial control, and risks implying that unrestricted egress or project secrets
cannot be abused.

Alternative considered: keep conceptual outcome screenshots as treatment hero proof. Rejected
because they demonstrate what an app generator might produce rather than what Podbay uniquely does.

### 5. Build the treatment catalog from readiness-gated environment data

The treatment starts from the real catalog instead of a second hard-coded aspirational list.
Presentation metadata can add treatment-specific proof points, but launchability comes from the
validated environment catalog plus an explicit release allowlist/readiness state. An unavailable
playbook is omitted or visibly non-launchable.

Morning Ops Robot cannot be presented as live proof until its documented image rebuild and
multi-day dogfood gate passes. Ask Your Docs must distinguish the coding-agent subscription from
the separate API key its deployed application requires. Codex language remains qualified until
the current second-class integration work is production-ready.

Alternative considered: expose every valid `podbay.yaml` automatically. Rejected because schema
validity is not the same as kill-test, dogfood, or public-claim readiness.

### 6. Add a narrow first-party attribution and runtime-control data model

Add four Drizzle tables:

- `landing_experiment_runs`: experiment id, runtime status, optional pinned variant, start/stop
  times, last admin actor, and update time. The immutable definition still lives in typed code.
- `landing_experiment_assignments`: `(experiment_id, visitor_id)` identity, semantic variant,
  eligibility, bounded initial referrer/UTM fields, optional `user_id`, and first/last seen times.
- `landing_experiment_events`: generated event id, experiment id, visitor id, optional user id,
  semantic variant, allowlisted event type, optional bounded item id, and occurrence time.
- `landing_experiment_audit`: immutable admin action, actor, typed prior/resulting status and pin,
  and timestamp.

A unique constraint deduplicates the exposure event per experiment and visitor. Assignment
upserts are idempotent. Events do not accept arbitrary JSON metadata and do not store raw IP
addresses. Campaign fields are normalized and length-bounded.

A same-origin route accepts allowlisted events and derives experiment, visitor, and assignment from
HttpOnly cookies/server state rather than trusting those values from the browser. The client sends
only the requested event and optional allowlisted item. `sendBeacon` or `fetch` with `keepalive`
records interactions without delaying navigation; failure is swallowed after structured logging.

Alternative considered: extend `pod_events`. Rejected because landing acquisition events have a
different lifecycle, identity, access pattern, and retention policy than authoritative pod state.

Alternative considered: continue with browser-only custom events. Rejected because there is no
consumer and no durable basis for an experiment decision.

### 7. Add a read-focused admin experiment console

The existing admin shell gains an Experiments navigation item and two server-rendered routes:

- `/admin/experiments`: all immutable experiment definitions joined to runtime status and compact
  exposure/primary-outcome summaries.
- `/admin/experiments/[id]`: read-only definition, runtime state, per-variant funnel counts/rates,
  bounded acquisition breakdowns, assignment and ingestion health, sanitized recent events, and
  admin audit history.

All queries aggregate on the server. Empty and low-sample states show counts and uncertainty rather
than winner language. Visitor ids are omitted from UI models; user ids appear only through existing
admin-safe user presentation where needed. Raw application logs remain in the normal observability
system, while the dashboard exposes experiment-specific ingestion/rejection counters and sanitized
event history.

Only Stop and Pin variant are mutable. Both use existing admin-gated server actions, confirmation
dialogs, server-side variant validation, idempotent runtime updates, and immutable audit rows.
Allocation, experiment id, variant definition, metric definition, and content cannot be edited in
the dashboard. Pin is allowed only for a declared variant and stops new enrollment.

Alternative considered: a full experiment editor. Rejected because changing allocation,
definitions, or content mid-run invalidates interpretation and creates a second configuration
source of truth.

Alternative considered: expose only a script/query. Rejected because experiment health and
decision data are operational product state that administrators need to inspect without shell or
database access.

### 8. Link attribution idempotently after authentication

The first authenticated Podbay page reached after sign-in calls a server-only attribution helper.
The helper reads the anonymous assignment cookies, upserts the assignment's `user_id`, and records
one `signin_completed` event. This avoids modifying or proxying the better-auth provider flow and
works for GitHub and magic-link entry points.

`launchPod` records `pod_created` after the authoritative launch succeeds. The authoritative
agent-auth/session milestone path records `agent_connected` when `authedAt` first transitions from
null. The first owner project/cockpit open records `first_project_opened` idempotently. Each helper
no-ops when attribution is absent, the experiment is disabled, or the event already exists.

Alternative considered: record sign-in only when the CTA is clicked. Rejected because a click is
not authentication completion and loses users who finish after an OAuth round trip.

### 9. Use stable canonical metadata and deterministic crawler behavior

The canonical metadata does not randomize. It truthfully describes Podbay as an always-on cloud
workspace for supported coding agents using the visitor's own subscription. Middleware serves a
configured canonical variant to recognized crawlers without enrolling them. Preview routes emit
`noindex` and the root canonical URL.

This means organic snippet performance is not part of the body-positioning experiment. It prevents
search crawlers and link unfurlers from seeing inconsistent content and consuming participant
assignments.

### 10. Pre-register interpretation and validate instrumentation before launch

The experiment is evaluated as a complete narrative comparison. Primary conversion is completed
sign-in; pod creation and agent connection are activation measures; first project open and later
return are quality measures. CTA clicks and section interactions diagnose behavior but do not
select the winner alone.

Before V2 receives production traffic, the assignment and event pipeline runs in an A/A
configuration or equivalent production validation window. Operators verify approximate allocation,
stable repeat assignment, one exposure per visitor, preview exclusion, auth linkage, and downstream
events. After the A/B test begins, material narrative changes require a new experiment id.

## Risks / Trade-offs

- **[Private-alpha traffic is too small for a decisive conversion result]** → Report counts and
  uncertainty, pair behavior with five-second comprehension interviews, and avoid declaring a
  winner from click-through alone.
- **[Middleware cookies and request headers diverge on the first response]** → Cover first-visit,
  repeat-visit, invalid-cookie, crawler, and preview flows with focused middleware tests.
- **[OAuth completion loses anonymous attribution]** → Use first-party root-path SameSite cookies
  and idempotent linkage on the first authenticated page rather than provider callback state.
- **[Bots pollute allocation or exposure]** → Use deterministic crawler rendering and mark
  authenticated/non-human observations ineligible.
- **[Treatment claims outrun current Codex or playbook readiness]** → Maintain a release claim
  checklist and readiness allowlist; block or qualify unsupported proof.
- **[Real screenshots expose user or secret data]** → Capture dedicated demo pods with simulated
  content and review assets before publishing.
- **[Event ingestion affects navigation]** → Keep the endpoint same-origin and non-blocking; never
  make a product action depend on analytics success.
- **[An admin action invalidates a running test]** → Keep the definition read-only, restrict
  mutations to Stop/Pin, require confirmation, validate server-side, and audit every successful
  transition.
- **[A broad treatment wins but the causal element is unknown]** → Accept this as a positioning
  test; isolate individual elements only in later experiments.

## Migration Plan

1. Add the experiment schema, migration, typed configuration, runtime controls, persistence
   helpers, admin console, and tests while the experiment is disabled.
2. Extract the current landing into the `outcomes` component and verify pixel/behavior parity.
3. Add assignment middleware and preview routes; keep `/` pinned to `outcomes`.
4. Wire exposure, CTA, authentication, and downstream activation events; run the A/A validation.
5. Build V2 from release-approved copy and real demo captures; verify desktop, 320px mobile,
   keyboard, reduced motion, metadata, and claim gates.
6. Enable equal allocation under `landing-positioning-2026-07`.
7. To stop or roll back, disable assignment and pin `/` to `outcomes`; retain collected events for
   analysis. No pod or authentication data requires rollback.

## Open Questions

- What minimum observation window and qualified-visitor count will be used before reading the
  result? Set this from baseline sign-in conversion once instrumentation is live.
- Production preview routes remain non-indexed and may be admin-gated in a follow-up if private
  alpha sharing becomes a problem.
- Which production-ready capture should carry the continuity hero: Bring Your Project or Morning
  Ops Robot after dogfood?
- What retention period should apply to anonymous experiment assignments and events?
