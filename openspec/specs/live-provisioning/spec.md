# live-provisioning Specification

## Purpose

Turn an approved user's launch into a real, running pod on the self-hosted Incus
box (the 2026-07-20 infra pivot: pods are Incus KVM VMs on our own hardware behind
the `SandboxProvider`; Fly is failover/edge, not the pod runtime). Provisioning is
durable and decoupled from the request path: `launchPod` writes a `provisioning`
pod row and returns, and a background worker claims the row and builds the machine
— crash-safe, idempotent, and retryable. The user is routed to a URL-addressable
pod workspace the instant launch returns, and reaches a working browser terminal
once the machine boots.

## Requirements

### Requirement: Launch enqueues a durable provisioning job

`launchPod` SHALL validate the environment and launch secrets, then persist a
durable `pods` row with status `provisioning` (and its secrets) and return WITHOUT
building any machine inline. The row IS the job: nothing is lost if the process
restarts between enqueue and build.

#### Scenario: Launch persists the job and returns immediately

- **WHEN** an approved user launches an environment
- **THEN** a `pods` row SHALL be created with status `provisioning`, owned by the
  user, addressable by its slug, with its launch secrets persisted to the vault,
  and the call SHALL return without waiting on a machine build

#### Scenario: Invalid environment or secrets has no side effects

- **WHEN** the environment does not resolve, or a launch secret is not declared by
  the environment
- **THEN** `launchPod` SHALL throw before writing any row, secret, or machine

### Requirement: The pod's agent is chosen at launch and overrides the env default

When an environment declares more than one agent, the launch flow SHALL let the user
choose which agent the pod runs; the choice SHALL be constrained to the environment's
declared agents (the server never trusts the client to widen the roster), persisted on
the `pods` row, and SHALL override the environment's default when the pod-spec is built.
When no choice is made (or the env declares a single agent) the environment's declared
agents SHALL stand (multi-agent-plan.md slice 3).

#### Scenario: A chosen agent wins over the env default

- **WHEN** a pod is launched with an agent the environment declares
- **THEN** the pod's `agents` SHALL be persisted and the built pod-spec SHALL carry that
  agent rather than the environment's default

#### Scenario: An undeclared agent choice is ignored

- **WHEN** a launch request names an agent the environment does not declare
- **THEN** that choice SHALL be dropped and the environment's declared agents SHALL stand

### Requirement: A background worker claims and builds provisioning pods

A provisioner worker SHALL periodically claim `provisioning` pods via a race-safe
lease and build each machine, reconstructing the build inputs from durable state
(environment, secrets, display name, size). The worker runs in the web process
(the single pod-lifecycle authority); the gateway retains a dormant equivalent
(`sweepProvision`) that is off unless a positive provision interval is configured.

#### Scenario: Worker builds a claimed pod

- **WHEN** the provisioner tick runs and a pod is stuck in `provisioning`
- **THEN** it SHALL claim the row by compare-and-swapping a lease (so multiple
  instances never double-build), build the machine on the pod's provider, and
  flip the row to its live status (`running`/`waking`) with the machine id, region,
  and image digest recorded

#### Scenario: Claim is exclusive across instances

- **WHEN** two worker instances see the same `provisioning` pod
- **THEN** the conditional lease UPDATE SHALL match for exactly one instance and
  return zero rows for the other, so only one builds the machine

### Requirement: Machines are built on the self-hosted Incus box

The provider SHALL create the pod as an Incus KVM virtual machine on our own box:
an instance named by the pod id, with `/home/dev` on a separate block home volume,
started and seeded with the pod's init files (pod-spec, kickoff, `.claude` layer,
secrets) before the agent is (re)loaded. Fly remains a failover/edge provider, not
the go-forward pod runtime.

#### Scenario: A launched pod becomes a running Incus VM

- **WHEN** the worker builds a claimed pod on the Incus provider
- **THEN** an Incus instance named by the pod id SHALL exist with its home volume
  attached, be started, have its init files pushed, and its `pod-agent` reachable
  at the instance's bridge address

#### Scenario: Build is idempotent by pod id

- **WHEN** a build is retried after a crash mid-create (a re-claimed pod, or a pod
  whose machine id is already recorded)
- **THEN** `createPod` SHALL adopt the existing instance/volume rather than create
  a duplicate, and finish the start + configure steps

### Requirement: Provisioning retries with backoff and is recoverable

A transient build failure SHALL NOT fail the pod permanently. On failure below the
attempt limit the worker SHALL leave the pod `provisioning` with a backoff lease so
the next tick re-claims it; only after exhausting attempts SHALL it mark the pod
`error` (recording the failure message) and best-effort clean up any half-built
machine. A crashed worker's expired lease SHALL be re-claimed automatically. A
`reconcile` SHALL never downgrade a `provisioning` pod — that status is the
worker's to own.

#### Scenario: Transient failure retries

- **WHEN** a build fails and the pod is below the attempt limit
- **THEN** the pod SHALL stay `provisioning` with `provision_error` set and a
  backoff lease, and the next tick SHALL re-claim and rebuild it

#### Scenario: Exhausted attempts surface an error

- **WHEN** a build fails at or beyond the attempt limit
- **THEN** the pod SHALL be marked `error` with `provision_error` recorded, a
  best-effort `destroy` SHALL clean up any partial machine, and the owner SHALL be
  able to re-enqueue it (reset to `provisioning`) via retry

### Requirement: Pod base image boots the agent

The pod base image SHALL boot with the official CLIs installed, run first-boot
seeding, and start the in-pod agent, so a newly built pod is ready for a terminal
connection.

#### Scenario: A launched pod becomes reachable

- **WHEN** a pod is built and reaches running
- **THEN** its `pod-agent` SHALL be serving on the pod-internal (bridge) address
  and report ready

### Requirement: Gateway is reachable and authenticated

The deployed gateway SHALL accept authenticated WebSocket connections from the
browser and proxy to the target pod's `pod-agent`, refusing unauthenticated or
cross-owner connections.

#### Scenario: Authenticated owner connects

- **WHEN** an approved user opens their pod's terminal in the browser
- **THEN** the gateway SHALL validate their session, authorize ownership, and
  stream the terminal

#### Scenario: Session validates across subdomains

- **WHEN** the browser connects to the gateway on a different subdomain than the app
- **THEN** the session cookie SHALL be sent and validated (cookie scoped to the
  parent domain)

### Requirement: End-to-end terminal works

A user SHALL be able to launch a pod and use an interactive terminal in the browser,
including signing into the agent CLI inside the pod.

#### Scenario: Launch to working terminal

- **WHEN** an approved user launches a pod and opens it
- **THEN** they SHALL see an interactive terminal, and SHALL be able to run the
  agent CLI login inside the pod

### Requirement: Provisioning failure never destroys a pre-existing machine, and a missing environment fails gracefully

Re-provisioning (a retry of a pod that already booted) SHALL NOT destroy the pod's machine or volume
on failure — the give-up cleanup only removes a machine that the CURRENT provisioning cycle created
from scratch. When a pod's environment no longer resolves (renamed or removed), provisioning SHALL
fail fast with a clear, actionable message, without consuming the retry budget and without any
destroy. The cockpit SHALL present this as unrecoverable — no "Try again", only delete.

#### Scenario: Retry of a booted pod keeps failing

- **WHEN** a pod that already has a machine is re-provisioned and every attempt fails
- **THEN** the pod ends in `error` with its machine and volume intact — never destroyed

#### Scenario: The environment was renamed or removed

- **WHEN** provisioning runs for a pod whose environment directory no longer exists
- **THEN** it sets `error` immediately with a message naming the environment and telling the owner to
  delete and relaunch, without retrying or destroying anything

#### Scenario: A fresh build that fails is still cleaned up

- **WHEN** a brand-new pod (no prior machine) fails to build past its retry budget
- **THEN** the half-built machine is destroyed so it can't leak

#### Scenario: The cockpit hides retry for an unrecoverable pod

- **WHEN** an errored pod's environment no longer exists
- **THEN** the error screen omits "Try again" and offers only delete
