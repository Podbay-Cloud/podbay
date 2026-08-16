## ADDED Requirements

### Requirement: Provider-agnostic pod lifecycle interface

The system SHALL define a `SandboxProvider` interface that abstracts pod lifecycle independent
of the underlying cloud. It SHALL expose at least: `createPod`, `getPod`, `listPods`, `exec`,
`sleep`, `wake`, `setKeepAwake`, `snapshot`, `destroy`, and `endpoint`. All infrastructure
specifics SHALL live behind implementations of this interface.

#### Scenario: Interface is provider-neutral

- **WHEN** a consumer imports `SandboxProvider`
- **THEN** its method signatures SHALL reference only Podbay domain types (`ResolvedPod`,
  `PodInfo`, ids) and SHALL NOT expose Fly-specific types

#### Scenario: Fly implementation conforms

- **WHEN** `FlyProvider` is instantiated
- **THEN** it SHALL satisfy the `SandboxProvider` interface with every method implemented

### Requirement: Provision a pod from a ResolvedPod

`createPod` SHALL accept a `ResolvedPod` (from `@podbay/shared`) plus an owner reference and
SHALL provision one isolated compute instance with one persistent volume. It SHALL be
idempotent: creating with an existing pod id SHALL return the existing pod rather than
duplicating infrastructure.

#### Scenario: Fresh provision

- **WHEN** `createPod` runs for a new pod id with a valid `ResolvedPod`
- **THEN** exactly one machine and one volume SHALL be created, tagged with the pod id, and a
  `PodInfo` with status SHALL be returned

#### Scenario: Idempotent re-create

- **WHEN** `createPod` runs again with an already-provisioned pod id
- **THEN** no additional machine or volume SHALL be created and the existing pod SHALL be
  returned

### Requirement: Isolation between pods

Each pod SHALL have its own compute instance and its own volume. No two pods SHALL share a
filesystem.

#### Scenario: Distinct filesystems

- **WHEN** two pods are provisioned
- **THEN** each SHALL have a distinct volume, and neither SHALL be able to read the other's
  filesystem

### Requirement: Persistent filesystem across sleep and restart

A pod's volume SHALL persist its contents across sleep/wake and across instance replacement, so
the user's workspace and the in-pod CLI login survive.

#### Scenario: Survives sleep/wake

- **WHEN** a pod is slept and later woken
- **THEN** files written before sleep SHALL still be present after wake

#### Scenario: Survives instance replacement

- **WHEN** a pod's compute instance is replaced (e.g. a config redeploy) but its volume is
  retained
- **THEN** the workspace contents SHALL remain intact

### Requirement: Sleep and wake with explicit keep-awake

The provider SHALL sleep a pod on request (preserving in-memory session state where the
platform supports it) and wake it on demand. A `keepAwake` flag SHALL prevent sleep while set,
so a pod stays up during an active Remote Control session.

#### Scenario: Sleep then wake preserves session

- **WHEN** `sleep` is called and then `wake`
- **THEN** the pod SHALL resume and, where the platform supports memory snapshotting, the prior
  process/session state SHALL be restored

#### Scenario: keepAwake blocks sleep

- **WHEN** `setKeepAwake(id, true)` has been called
- **THEN** a subsequent `sleep(id)` SHALL be refused or deferred until keep-awake is cleared

### Requirement: Config and setup injection at first boot

On first provision the provider SHALL seed the pod with the environment's `.claude/` config
layer and the resolved permission preset, and SHALL run the environment's `setup` steps once
before the agent CLI is available. It SHALL NOT inject model credentials.

#### Scenario: Config seeded once

- **WHEN** a pod is first provisioned from a `ResolvedPod` with a `.claude/` layer and setup
  steps
- **THEN** the `.claude/` config and permission preset SHALL be present in the pod and the setup
  steps SHALL have run before first agent start; a later wake SHALL NOT re-run setup

#### Scenario: No credential injection

- **WHEN** provisioning any pod
- **THEN** the provider SHALL NOT write any model API key, auth token, or auth base-url into the
  pod

### Requirement: Exec and endpoint access

The provider SHALL run a one-off command in a pod via `exec` and SHALL expose the pod's agent
endpoint (the address the control plane connects to for the terminal bridge) via `endpoint`.

#### Scenario: Exec returns result

- **WHEN** `exec(id, ["echo", "hi"])` runs on a running pod
- **THEN** it SHALL return the command's exit code and captured output

#### Scenario: Endpoint resolves for a running pod

- **WHEN** `endpoint(id)` is called for a running pod
- **THEN** it SHALL return a reachable address for that pod's agent port

### Requirement: Teardown removes all pod infrastructure

`destroy` SHALL remove both the compute instance and the volume for a pod, leaving no billable
resources behind.

#### Scenario: Destroy is complete

- **WHEN** `destroy(id)` completes
- **THEN** neither the machine nor the volume for that pod SHALL remain, and `getPod(id)` SHALL
  report the pod as gone
