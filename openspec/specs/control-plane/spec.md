# control-plane Specification

## Purpose

The control plane orchestrates a `SandboxProvider` against a `PodStore`: it launches pods,
persists a durable record for each, and exposes ownership-scoped lifecycle, resize, image-update,
secret, and status-reconciliation operations. Pods run 24/7 (always-on) — there is no automatic
idle-to-sleep or auto-wake sweep for go-forward pods; suspend and resume are explicit user verbs.
The service never handles end-user credentials; each pod performs its own agent login.

## Requirements

### Requirement: Pod status is refreshed on a timer, not by page views

The platform SHALL re-check pod status against the provider periodically, independently of anyone
opening a page.

Without this, status is only refreshed when a dashboard is viewed, a pod is in a transient state, or an
operator opens a drill-in — and the idle sweep skips Incus pods entirely. A pod that crashed keeps
reading "running" and a pod that recovered keeps reading "suspended", and every consumer of status
inherits that staleness: the control sockets, the idle policy, and fleet health alike.

The sweep SHALL cover the fleet in bounded slices rather than re-checking every pod each pass, because
re-checking talks to the provider per pod and a large fleet would turn one timer into a burst. Coverage
SHALL rotate so no pod is starved. A pod whose re-check fails SHALL NOT prevent the rest of the slice
from being re-checked.

Terminal states SHALL be excluded — there is nothing to learn about a pod that is gone.

#### Scenario: A pod crashes between page views

- **WHEN** a running pod stops responding and nobody opens a dashboard
- **THEN** a later sweep SHALL re-check it and correct its status

#### Scenario: A fleet larger than one slice

- **WHEN** more pods exist than a single sweep re-checks
- **THEN** successive sweeps SHALL continue through the fleet and wrap around

### Requirement: Pod persistence via a store abstraction

The control plane SHALL persist pod records through a `PodStore` abstraction (create, get,
list-by-owner, update, delete, and append/list lifecycle events). The service SHALL depend on the
interface, not a concrete store, so it runs against an in-memory store in tests and a database
store in production, and it SHALL accept any `SandboxProvider`.

#### Scenario: Records survive and are retrievable

- **WHEN** a pod record is created in the store
- **THEN** it SHALL be retrievable by its id and appear in its owner's list

#### Scenario: Service is store- and provider-agnostic

- **WHEN** the `PodService` is constructed
- **THEN** it SHALL accept any `PodStore` implementation and any `SandboxProvider`

### Requirement: Launch creates a durable provisioning record

`launchPod(ownerId, environmentName, opts)` SHALL resolve a first-party environment (via
`@podbay/shared`), then create and persist a pod record in status `provisioning` linking the pod
to its owner and environment BEFORE any machine exists. The record SHALL be durable and
URL-addressable the instant launch returns; it does not create a provider machine synchronously.
The record's row itself is the provisioning job.

#### Scenario: Successful launch returns a provisioning record

- **WHEN** `launchPod` is called with a valid environment name
- **THEN** a record SHALL be stored with the owner, environment, pod id, chosen lifecycle, chosen
  compute size (defaulting to Small), and status `provisioning`, and that record SHALL be returned
  without waiting for a machine to be built

#### Scenario: Unknown or unsafe environment is rejected

- **WHEN** `launchPod` is called with an environment that does not resolve or whose name is unsafe
- **THEN** it SHALL fail without creating any provider resource or store record

#### Scenario: Launch persists validated secrets

- **WHEN** `launchPod` is given secret values for keys the environment declares
- **THEN** unknown keys SHALL be rejected, blank values dropped, and the accepted values SHALL be
  stored encrypted in the secret vault against the new pod id for the provisioner to inject

### Requirement: Durable, retryable provisioning worker

A background provisioner worker SHALL claim pods stuck in `provisioning` via a race-safe lease
(so multiple gateway instances never double-build), reconstruct the `createPod` inputs from
durable state (resolved environment plus vault secrets), and build the machine. Building SHALL be
idempotent by pod id (a partial machine is adopted, not duplicated), and failures SHALL be
retried with backoff up to a maximum attempt count before the pod is marked `error`.

#### Scenario: A claimed provisioning pod is built and marked running

- **WHEN** the provisioner claims a `provisioning` pod and the machine boots and its agent is
  reachable
- **THEN** the record SHALL be updated to `running` with its machine id, region, and image digest,
  and a `running` event SHALL be emitted

#### Scenario: Provisioning retries then fails durably

- **WHEN** building a claimed pod throws
- **THEN** the worker SHALL shorten the lease for a retry until the max attempt count is reached,
  after which it SHALL best-effort tear down any partial machine and set the pod to `error` with
  the failure recorded

#### Scenario: A failed pod can be retried

- **WHEN** the owner retries a pod in status `error`
- **THEN** its job state SHALL be reset to a fresh unleased `provisioning` claim so the worker
  rebuilds it, and retrying a non-error pod SHALL be rejected

### Requirement: Ownership isolation

Pod queries and mutations SHALL be scoped to an owner. A user SHALL only see and control their own
pods. Admin-scoped operations exist for the backoffice but are gated by the web layer and resolve
the pod's real owner before delegating, so events stay attributed to the actual owner.

#### Scenario: List returns only the owner's pods

- **WHEN** two owners each launch pods and one owner lists pods
- **THEN** only that owner's pods SHALL be returned

#### Scenario: Cross-owner access is denied

- **WHEN** an owner requests or mutates a pod they do not own
- **THEN** the operation SHALL be denied (treated as not found, without leaking existence)

### Requirement: Pods are always-on; suspend and resume are explicit

Go-forward pods run 24/7 (always-on). The control plane SHALL NOT automatically suspend a pod for
being idle nor automatically wake it on a sweep. A pod's `keepAwake` flag SHALL be derived `true`
for the `always-on` lifecycle. Suspending (`sleep`) and resuming (`wake`) a pod SHALL only happen
as explicit, owner-scoped operations that delegate to the provider and update the stored record.

#### Scenario: Explicit resume delegates and holds waking

- **WHEN** an owner resumes (wakes) a suspended pod
- **THEN** the provider SHALL be asked to wake it and the record SHALL be set to `waking` (with
  `lastActiveAt` bumped) until reconciliation confirms the agent is reachable

#### Scenario: Explicit suspend delegates and records the transition

- **WHEN** an owner suspends (sleeps) a pod
- **THEN** the provider SHALL be asked to suspend it, the record's status SHALL be updated, and a
  `suspended` event SHALL be emitted

#### Scenario: No automatic idle suspension of go-forward pods

- **WHEN** an always-on, Incus-hosted, or self-host `local` (Docker) pod sits idle
- **THEN** the control plane SHALL NOT suspend it automatically (a self-host pod runs on the owner's
  own machine, where an automatic `docker stop` would surprise them and kill their agent)

### Requirement: An account has a slot budget

Each account has a fixed **slot budget**. A pod occupies slots by size — memory ÷ 4 GB, so
**Small = 1, Medium = 2, Large = 4** — and the budget is spent the same whether it is four small
pods, two mediums, one large, or a mix. The default budget is 4 slots.

A pod occupies its slots UNLESS it is **suspended** — a suspended pod has released its compute, so
those slots are free for another pod (and resuming it needs them back). error/gone pods hold none.

Launching, resuming, or resizing-UP a pod SHALL be **refused before any side effect** when it would
push the account's used slots past its budget; the refusal SHALL be a distinct, surfaced error (not a
generic failure) that tells the owner to suspend a pod or contact support for more. The budget is
per-account and one account's pods SHALL NOT count against another's. Callers MAY exempt an account
(an unbounded budget) — admins are exempt so they can run the fleet.

#### Scenario: A launch that would exceed the budget is refused with no side effect

- **WHEN** an owner at their slot budget launches another pod
- **THEN** the launch SHALL be refused with a slot-limit error and no pod record SHALL be written

#### Scenario: Suspending frees slots; resuming needs them back

- **WHEN** an owner suspends a pod, its slots become available for a new pod; and **WHEN** they later
  resume a suspended pod whose freed slots have since been taken
- **THEN** the new pod SHALL be allowed, and the resume SHALL be refused with a slot-limit error until
  enough slots are free

#### Scenario: A resize that would exceed the budget is refused

- **WHEN** an owner resizes a running pod UP to a size that would not fit their remaining budget
- **THEN** the resize SHALL be refused with a slot-limit error and the pod SHALL be left unchanged

#### Scenario: Exempt (admin) accounts are unbounded

- **WHEN** an exempt account launches, resumes, or resizes pods
- **THEN** the slot budget SHALL NOT limit it

### Requirement: Lifecycle policy selection

A pod SHALL carry a lifecycle policy chosen at launch (defaulting to the environment's default).
An environment MAY lock its lifecycle, in which case a differing override SHALL be rejected. The
owner MAY change a pod's lifecycle later, subject to the same lock. Selecting `always-on` SHALL
derive `keepAwake` true and sync it to the provider; other policies derive `keepAwake` false.

#### Scenario: Locked environment rejects a differing lifecycle

- **WHEN** a launch or change requests a lifecycle other than the one an environment locks
- **THEN** the operation SHALL be rejected

#### Scenario: always-on derives keepAwake

- **WHEN** a pod's lifecycle is set to `always-on`
- **THEN** the record SHALL reflect `keepAwake = true` and the provider SHALL be told to keep it awake

### Requirement: Destroy tears down and removes the record

`destroy` SHALL be owner-scoped. It SHALL mark the record `destroying` first (teardown is slow and
the UI must keep showing it across refreshes), delegate teardown to the provider, emit a
`destroyed` event before deleting the row, and then remove the store record.

#### Scenario: Destroy removes the record

- **WHEN** an owner destroys a pod
- **THEN** the record SHALL be set to `destroying`, the provider SHALL tear it down, a `destroyed`
  event SHALL be emitted, and the store record SHALL be removed

#### Scenario: Teardown failure leaves the row destroying

- **WHEN** provider teardown throws during destroy
- **THEN** the record SHALL be left in `destroying` (not resurrected) so an idempotent retry can
  complete it

### Requirement: Resize a pod's compute tier

`resizePod` SHALL be owner-scoped and allowed only from a settled state (`running` or `suspended`).
CPU/RAM come from the new size and may move down; disk is grow-only, so the pod keeps
`max(current, new)`. The provider applies the change with a brief cold restart, the record is
updated with the new size, disk, and returned status, and a `resized` event is emitted.

Because the cold restart kills the running agent — exactly like an image update — a resize of a
RUNNING pod SHALL first request a handoff (see session-handoff) and SHALL leave a one-time note of
the pod's new resources for the resumed agent; both are best-effort and SHALL NEVER fail the resize.
A resize of a SUSPENDED pod SHALL do neither (no live agent, no reachable machine).

#### Scenario: Resize keeps the larger disk

- **WHEN** an owner resizes a pod to a smaller tier
- **THEN** the pod SHALL adopt the new size's CPU/RAM but retain the larger of its current and the
  new tier's disk, and a `resized` event SHALL be emitted

#### Scenario: Resize is rejected mid-transition

- **WHEN** a resize is requested for a pod that is not `running` or `suspended`
- **THEN** the operation SHALL be rejected

### Requirement: Update a pod's image in place

`updatePodImage` SHALL be owner-scoped and apply a new image while keeping the volume (work tree,
agent data, and login survive). A running pod cold-restarts and its stale bridge session URL is
cleared for reconciliation to repopulate; a suspended pod is left suspended and picks up the image on
its next resume. The record SHALL record the new image digest and an `updated` event with the
from/to digests. When the pod is running and has secrets, they SHALL be re-injected.

The update SHALL resolve the pod's environment at update time and pass the freshly-resolved
`.claude` layer to the provider, so updating a pod also delivers skills/rules shipped since the
pod was created. A missing or invalid environment (e.g. renamed away under a live pod) SHALL NOT
fail the image update — the pod simply keeps its existing layer.

#### Scenario: Image update records from/to and clears the stale session

- **WHEN** an owner updates a running pod's image
- **THEN** the record's image digest SHALL be updated, its `sessionUrl` cleared, secrets
  re-injected, and an `updated` event carrying the previous and new digests SHALL be emitted

#### Scenario: Update carries the current config layer

- **WHEN** an owner updates a pod whose environment still resolves
- **THEN** the freshly-resolved `.claude` layer SHALL be handed to the provider with the update

#### Scenario: Environment no longer resolves

- **WHEN** the pod's environment is missing or invalid at update time
- **THEN** the image update SHALL proceed without a layer, and the failure SHALL be logged, not
  surfaced as an update error

#### Scenario: A hung image update recovers instead of stranding the pod

- **WHEN** an image update has been in flight past a stale window (the detached recreate hung on an
  infrastructure operation, or a gateway restart killed it mid-recreate, so it neither completed nor
  threw)
- **THEN** a maintenance sweep SHALL treat it as hung: bring the pod back up on its EXISTING image
  (best-effort) and fail the update so the cockpit shows an error the owner can retry, rather than
  leaving the pod stopped and the cockpit wedged on "Updating" indefinitely
- **AND** an update still within the stale window SHALL NOT be disturbed, so a legitimately slow
  recreate is never interrupted

### Requirement: Encrypted app-secret management

The control plane SHALL manage per-pod app secrets through an encrypted secret vault, owner-scoped.
Listing SHALL cross the environment's declared secrets with which keys the owner has set (never the
values) and SHALL surface set-but-undeclared keys so they can be cleared, while HIDING the reserved
BYO-repo clone token. Setting or clearing a secret on a running pod SHALL push the updated set to
the pod live; otherwise the change lands on the next resume, with the DB as source of truth.

#### Scenario: Secret status reflects declared and set keys

- **WHEN** an owner lists a pod's secrets
- **THEN** each declared key SHALL report whether it is set (without exposing values), extra set
  keys SHALL be listed for clearing, and the reserved clone token SHALL NOT appear

#### Scenario: Live push when running

- **WHEN** an owner sets or clears a secret on a running pod
- **THEN** the vault SHALL be updated and the pod's current secret set SHALL be pushed to it live

### Requirement: Activity and onboarding milestones

`lastActiveAt` SHALL reflect when the pod's AGENT last did real work — NOT terminal traffic. "Real
work" is the timestamp of the agent's newest TRANSCRIPT entry: a message, tool call, or tool result
(the same source the agent app shows), which correctly counts remote-control and autonomous turns and
long silent tool tasks. Terminal traffic SHALL NOT bump it: a running app or a spinner streams
terminal output every second, which pinned an idle pod to "active now" (observed on prod 2026-08-19);
the gateway's terminal `markActive`/`touch` path is therefore removed. Wherever the control plane
already has a health probe in hand (the reconcile sweep, the dashboard signals sweep), it SHALL
advance `lastActiveAt` to that transcript time when it is newer than the recorded value — never moving
it backward, margin-throttled. The signal is `lastActivityMs` from the pod's `/healthz` on images that
report it; for OLDER images that do not, the control plane SHALL read the same two transcript sources
(Claude transcripts + Codex rollouts) in-pod via `exec`, throttled per pod (~60s), so an un-updated
pod shows honest agent time WITHOUT a recreate. The control plane SHALL NOT fall back to the live
`agentStatus` `busy`/`idle` flag, which flickers `busy` for an idle agent and would re-pin it to
"now". This keeps every reader honest: "active X ago", the default recency sort, and the idle-update
dwell reflect real agent work, so a pod used only via the app (whose traffic never touches the
terminal) is not shown idle-for-hours while its agent is busy, and an idle pod whose app is noisy on
the terminal is not shown active. Consequence, accepted: a pod used purely via its terminal SHELL with
no agent turn reads as idle. It SHALL also record idempotent onboarding milestones — `authedAt` when the
agent first reports logged in, and `sessionUrl` (the remote-control deep link) — so the launch
wizard's step survives refresh, close, and resume.

#### Scenario: markActive updates activity only

- **WHEN** `markActive` is called for an owner's pod
- **THEN** the record's `lastActiveAt` SHALL be updated and no provider call SHALL be made

#### Scenario: Agent work advances activity even without terminal traffic

- **WHEN** a health probe reports the agent was active (a recent turn) more recently than the pod's
  recorded `lastActiveAt`
- **THEN** `lastActiveAt` SHALL be advanced to that time, so agent work via remote-control or
  autonomously counts as activity; and it SHALL NOT be moved backward when the agent's last turn is
  older than the recorded value

#### Scenario: Milestones are recorded once

- **WHEN** the agent's logged-in status (or session URL) is first observed
- **THEN** `authedAt` (or `sessionUrl`) SHALL be set, and a later re-observation SHALL NOT move an
  already-set value

### Requirement: Status reconciliation

The control plane SHALL refresh a stored record's status from the provider's current truth so
externally-changed states are reflected, EXCEPT it SHALL never clobber a `provisioning` pod (the
worker owns that). A machine reported "started" SHALL be held at `waking` until its agent actually
accepts a connection, so `running` means connectable. Reconciliation SHALL capture/refresh the
remote-control session URL, backfill missing machine id / image digest on legacy rows, re-inject
secrets on the first reachable transition, and emit `running`/`suspended` events for out-of-band
transitions it detects.

The not-running status/event token is `suspended` (renamed from the legacy `sleeping` on 2026-08-02;
existing `pods.status` and `pod_events.type` rows are migrated). Readers of the persisted token — the
store read path and the usage/incident event folds — SHALL tolerate the legacy `sleeping` value so
un-migrated or in-flight history still resolves correctly.

#### Scenario: Reconcile updates a stale record

- **WHEN** the provider reports a pod's status differs from the stored record (and the pod is not
  provisioning)
- **THEN** reconciliation SHALL update the record to the provider's live status

#### Scenario: Provisioning is not clobbered

- **WHEN** reconciliation runs against a pod still in `provisioning`
- **THEN** it SHALL leave the record untouched for the provisioner worker to own

#### Scenario: Out-of-band transition is captured

- **WHEN** reconciliation detects a running or suspended transition it did not itself cause
- **THEN** it SHALL emit the corresponding lifecycle event so the timeline reflects reality

### Requirement: Automatic config-drift reconciliation

The control plane SHALL keep a running pod's config layer in sync with its environment's CURRENT
resolved layer automatically, with no owner action. It SHALL record on each pod a hash of the config
layer (the `/etc/podbay/claude/*` files plus the permissions slice) LAST DELIVERED to it — set at
create, at image update, and at every in-place delivery. During status reconciliation of a RUNNING
pod, when the provider supports in-place refresh, the control plane SHALL recompute the env's current
layer hash and:

- when the pod has no recorded hash (a fresh or legacy pod), BASELINE it to the current hash WITHOUT
  delivering — the pod already carries that layer from boot;
- when the recorded hash differs from the current hash (real drift), DELIVER the current layer in
  place via the provider's refresh, record the new hash, and emit a `config_refreshed` event marked
  automatic;
- when they are equal, do nothing.

The delivery SHALL be best-effort and MUST NOT fail reconciliation; an env that no longer resolves
SHALL be skipped (nothing delivered, nothing recorded). A pod whose refresh keeps failing SHALL be
rate-limited so it is not re-attempted on every sweep. This behavior replaces any manual "sync
config" action.

#### Scenario: Fresh pod is baselined without a delivery

- **WHEN** a running pod with no recorded config hash is reconciled
- **THEN** its config hash SHALL be recorded from the current layer and no in-place delivery SHALL
  occur

#### Scenario: Drifted pod is re-synced in place

- **WHEN** a running pod's recorded config hash differs from the env's current layer hash
- **THEN** the current layer SHALL be delivered in place, the pod's recorded hash SHALL be updated,
  and an automatic `config_refreshed` event SHALL be emitted

#### Scenario: In-sync pod is left alone

- **WHEN** a running pod's recorded config hash equals the current layer hash
- **THEN** no delivery SHALL occur

#### Scenario: Unresolvable environment is skipped

- **WHEN** the pod's environment no longer resolves at reconcile time
- **THEN** no delivery SHALL occur and the recorded hash SHALL be left unchanged, without failing
  reconciliation

### Requirement: Interrupting lifecycle actions request a handoff first

Update and suspend SHALL, after the owner confirms and before the provider recreates or stops the
instance, make a best-effort request for a handoff note from each live agent window. The request
SHALL be bounded by a timeout and SHALL be isolated from the lifecycle action: any failure, timeout,
or absence of a running agent SHALL be logged and ignored, and the action SHALL proceed exactly as
it does without this feature.

#### Scenario: Handoff request fails

- **GIVEN** the handoff request throws, times out, or finds no live agent
- **WHEN** the update or suspend continues
- **THEN** it SHALL complete with the same outcome and durable progress reporting as before, and the
  failure SHALL NOT surface to the owner as an error

#### Scenario: Bounded added latency

- **WHEN** a handoff is requested as part of an interrupting action
- **THEN** the added delay SHALL be bounded by the configured timeout and SHALL NOT extend
  indefinitely on an unresponsive agent

### Requirement: Owner-scoped add-agent action

The control plane SHALL expose an owner-scoped action to add an agent to an existing pod. It SHALL
validate that the agent is declared by the pod's environment and is not already present, persist it
to the pod's agent list, and cause it to start on the running pod without recreating the instance or
interrupting an existing agent. The action SHALL be idempotent: adding an agent the pod already runs
SHALL leave state unchanged rather than starting a duplicate.

#### Scenario: The pod's record lists no agents yet

- **WHEN** an agent is added to a pod whose record predates per-pod agent recording (empty list) but
  which runs its environment's primary agent
- **THEN** the primary SHALL be preserved alongside the new agent — the add JOINS, never replaces.
  Otherwise the record claims only the new agent, the dashboard drops the running agent's card, and
  it offers to "add" an agent the pod is already running

#### Scenario: Add succeeds

- **WHEN** an owner adds a valid, not-yet-present agent to their running pod
- **THEN** the pod record SHALL list it, it SHALL start on the pod, and the existing agent's session
  SHALL be unaffected

#### Scenario: Not the owner

- **WHEN** a non-owner attempts to add an agent
- **THEN** the request SHALL be refused as not found, consistent with other pod actions

#### Scenario: Repeated request

- **WHEN** the same add request is made twice
- **THEN** the second SHALL be a no-op rather than spawning a second instance of that agent
