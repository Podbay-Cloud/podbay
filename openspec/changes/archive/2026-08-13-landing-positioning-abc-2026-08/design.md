## Context

The July landing experiment is implemented as a single compile-time definition. Variant types,
allocation, assignment, root rendering, persistence constraints, report initialization, admin
actions, and controls all assume exactly `outcomes` and `agent-computer`. Production still uses its
A/A delivery mode, and its anonymous assignment and event data must remain attributable to the
July definition.

The `agent-home` page already exists as an isolated preview on commit `2a4d046`. The rollout must
also revise A and B before measurement, because their current readiness labels and some claims are
inconsistent. Another agent works from the shared main checkout, so all implementation occurs in a
dedicated worktree and branch.

## Goals / Non-Goals

**Goals:**

- Ship three complete, truthful landing bundles with deterministic previews and comparable CTA
  measurement.
- Start a new August experiment without combining it with July data or losing July admin history.
- Generalize assignment, storage, attribution, reporting, and controls enough to support declared
  landing variants without building a visual experimentation platform.
- Make the admin console show allocation, preview access, sample/readiness state, balance health,
  per-variant acquisition, and uncertainty appropriate to a three-arm exploratory test.
- Deploy safely through schema migration, A/A/A validation, and an explicit measured-mode switch.

**Non-Goals:**

- Runtime editing of experiment definitions, allocation, metrics, or content.
- A statistical decision engine that declares an automatic winner.
- Reworking authentication, approval, pricing, provisioning, or playbook readiness.
- Isolating any individual headline, CTA, visual, or layout variable.

## Decisions

### Use an immutable definition registry with one active acquisition experiment

Code will export a registry containing the historical July definition and the active August
definition. Read/report functions resolve a supplied ID through that registry; assignment,
ingestion, and new downstream attribution use the active definition. This preserves historical
admin pages while keeping the public path unambiguous.

Alternative considered: replace the July constant in place. Rejected because material copy,
variant, allocation, and schema changes would combine incompatible observations and make July data
unreadable through the current singleton dashboard.

### Use semantic variants shared across definitions

`outcomes`, `agent-computer`, and `agent-home` remain semantic IDs. A definition declares its own
subset, allocation, fallback, crawler variant, cookie, and delivery mode. Generic cumulative
allocation chooses a variant and validates that declared weights total 100.

Alternative considered: encode A/B/C letters. Rejected because semantic IDs remain intelligible in
events, admin controls, screenshots, and future historical reports.

### Separate assignment from delivery

In validation mode, middleware still assigns across all three August variants and writes the new
cookie, while root rendering deliberately serves one configured validation control. In measured
mode, root rendering serves the assigned semantic variant. This preserves the useful July A/A
instrumentation pattern as A/A/A.

### Expand existing database checks with a forward migration

The text columns remain text; a migration drops and recreates the four variant check constraints to
accept `agent-home`. No existing rows are rewritten. July rows remain valid and queries remain keyed
by experiment ID.

Alternative considered: remove variant checks entirely. Rejected because allowlisted persistence is
a useful privacy and data-quality boundary.

### Keep the three pages as complete bundles

A and B receive the agreed pre-freeze corrections; C retains its distinctive CTA and design. The
test intentionally measures coherent page bundles. Shared product facts, access behavior, canonical
metadata, responsiveness, and analytics contract remain consistent, while narrative, visuals, and
CTA language may differ.

### Make native Claude apps the Agent Computer control surface

The Agent Computer hero will show one conversation moving from Claude Desktop, across a running
pod, to Claude Mobile. Claude owns all task knowledge, questions, and results. The pod is a quiet
persistence layer and may show only shipped lifecycle and connection state such as `RUNNING` and
`Claude Remote Control on`; it must not claim to track tests, task progress, or preview updates.
Podbay's browser terminal will not appear in the primary product visual or be presented as a peer
workflow. It remains a below-fold administrative capability for inspection, debugging, and
recovery. The walkthrough stays visibly labeled as simulated.

Alternative considered: retain equal Claude app, terminal, and preview panels. Rejected because it
makes the administrative terminal look like the normal product interface and undercuts the native
Claude continuity promise.

Alternative considered: show test and preview-update receipts inside a card named "Podbay
computer." Rejected because Podbay does not observe those task-level results, and the product calls
the persistent machine a pod.

### Use descriptive uncertainty instead of winner automation

The dashboard will expose Wilson 95% intervals for funnel rates, operational sample progress, an
assignment-balance warning, and explicit validation/exploratory/insufficient-evidence language. It
will not perform unplanned repeated significance tests or declare a winner.

### Keep operational mutations limited to Stop and Pin

Controls resolve variants from the selected definition and reject mutations for historical
definitions. The August experiment remains code-defined. Preview links are read-only and bypass
assignment/measurement.

## Risks / Trade-offs

- [Three arms dilute traffic] → Present sample progress honestly and treat the declared minimum as
  an operational floor, not proof of a small lift.
- [Bundle differences limit causal interpretation] → Label the experiment as a positioning-bundle
  test and avoid claims about an individual headline or graphic.
- [Deployment briefly runs code before/after migration] → The migration is backward-compatible;
  apply it before enabling measured August delivery. Old code accepts old rows after migration.
- [Historical downstream events could attach to the wrong run] → New attribution reads only the
  active experiment assignment; July remains queryable but receives no new product events after
  the August cutover.
- [Concept imagery is mistaken for product proof] → Keep persistent conceptual/simulated labels and
  align readiness gates across A and B.
- [Concurrent repository work creates conflicts] → Rebase and resolve only in the isolated
  `codex/landing-positioning-abc` worktree; never switch or edit the shared main checkout.

## Migration Plan

1. Merge the three landing compositions and generalized code with measured delivery disabled.
2. Apply the database constraint migration.
3. Deploy in A/A/A validation mode and verify three-way cookie assignment, one control render,
   previews, event deduplication, and a real signed-in activation path.
4. Confirm admin history shows July and August, and verify Stop/Pin against the August definition.
5. Set the August delivery environment to measured mode and deploy approximately 34/33/33 traffic.
6. Roll back by stopping and pinning a declared variant; code rollback remains schema-compatible.

## Open Questions

- No user decision blocks implementation. The production mode switch and real-account activation
  verification require owner access after deployment.
