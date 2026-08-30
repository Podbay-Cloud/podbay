# sandbox-provider Specification

## Purpose

The sandbox-provider layer defines the provider-agnostic `SandboxProvider` interface that abstracts a pod's whole lifecycle behind Podbay domain types, so the control plane never touches cloud-specific APIs. Incus (KVM virtual machines on our self-hosted box) is the primary, live implementation; Fly Machines is the failover/edge implementation. Both conform to the same interface, so the control plane cannot tell them apart.

## Requirements

### Requirement: Support diagnoses a pod without a shell on it

The platform SHALL provide a bounded diagnostic collection that an operator can run on any pod, and
SHALL NOT provide an operator terminal into a pod they do not own.

A shell is unbounded and unauditable in CONTENT. A pod holds the owner's source, their forge token
and git credential helper, the secret values in their environment, and their agent's session
transcripts — the most private material on the machine. The platform can record that an operator
opened a terminal; it can never record what they read.

The collection SHALL describe the MACHINE — disk by directory, free space, listening ports, process
NAMES, service state, package-manager state, the platform's own setup log, and zero-byte files. It
SHALL NOT include file contents, environment values, the user's application logs, agent session
transcripts, or anything under the work directory beyond names and sizes.

Process command lines SHALL be excluded specifically: an argument can carry a credential, and a
diagnostic bundle that leaks a secret is worse than the outage it was collecting. Collected text
SHALL additionally be scrubbed of credential-shaped values.

Every section SHALL be named and shown in full — an unlabelled dump is indistinguishable from a
shell, and the case for this over a shell rests on a reader seeing exactly what was taken.

Collection SHALL be recorded as an admin action, so the owner learns that support looked.

#### Scenario: Operator investigates novel breakage

- **WHEN** doctor has no finding for a broken pod
- **THEN** the operator SHALL be able to collect named diagnostics, and SHALL NOT be offered a terminal

#### Scenario: A credential appears in collected text

- **WHEN** a collected section contains a credential-shaped value
- **THEN** it SHALL be redacted before the report is returned

### Requirement: Maintenance stops SHALL NOT power-cut a pod

Any provider operation that stops a RUNNING pod while its volume survives — update, resize — SHALL
flush the guest filesystem and request an orderly shutdown before stopping it. A forced stop is only
permitted as a fallback after the orderly stop fails, and when the volume is being deleted anyway.

For a virtual machine, a forced stop is a power cut. The guest never flushes, and a delayed-allocation
filesystem then keeps the METADATA of recently written files while losing their contents: files return
with the right name, the right timestamp, and zero bytes. An owner's pod came back from an update with
20 of 23 `node_modules/.bin` shims zeroed minutes after a package install (2026-07-29). Files
surviving an update is the platform's central promise, so this path may not cut power while data is
unflushed.

#### Scenario: Updating a healthy pod

- **WHEN** a running pod is updated or resized
- **THEN** the guest SHALL be flushed and stopped in an orderly way, and SHALL NOT be forced

#### Scenario: A guest that will not shut down

- **WHEN** the orderly stop fails
- **THEN** the pod SHALL be forced to stop, after the flush has already run

#### Scenario: Deleting a pod

- **WHEN** the pod and its volume are being deleted
- **THEN** a forced stop is permitted, as no data remains to flush

### Requirement: Provider-agnostic pod lifecycle interface

The system SHALL define a `SandboxProvider` interface that abstracts pod lifecycle independent
of the underlying cloud. It SHALL expose at least: `createPod`, `getPod`, `listPods`, `exec`,
`sleep`, `wake`, `setKeepAwake`, `resize`, `snapshot`, `destroy`, `endpoint`, and `updateImage`.
All infrastructure specifics SHALL live behind implementations of this interface.

#### Scenario: Interface is provider-neutral

- **WHEN** a consumer imports `SandboxProvider`
- **THEN** its method signatures SHALL reference only Podbay domain types (`ResolvedPod`,
  `PodInfo`, `PodResources`, ids) and SHALL NOT expose Incus- or Fly-specific types

#### Scenario: Incus implementation is the primary conformer

- **WHEN** `IncusProvider` is instantiated
- **THEN** it SHALL satisfy the `SandboxProvider` interface with every method implemented, and
  it SHALL be the primary/live implementation (pods as Incus KVM virtual machines on the box)

#### Scenario: Fly implementation conforms as failover

- **WHEN** `FlyProvider` is instantiated
- **THEN** it SHALL satisfy the same `SandboxProvider` interface with every method implemented,
  serving as the failover/edge provider

### Requirement: Provision a pod from a ResolvedPod

`createPod` SHALL accept a `CreatePodInput` (carrying a `ResolvedPod` from `@podbay/shared`) plus
an owner reference and SHALL provision one isolated compute instance with one persistent home
volume. It SHALL be idempotent by pod id: creating with an existing pod id SHALL adopt and return
the existing pod rather than duplicating infrastructure.

#### Scenario: Fresh provision

- **WHEN** `createPod` runs for a new pod id with a valid `ResolvedPod`
- **THEN** exactly one compute instance (named by / tagged with the pod id) and one home volume
  SHALL be created, and a `PodInfo` with status SHALL be returned

#### Scenario: Idempotent re-create

- **WHEN** `createPod` runs again with an already-provisioned pod id
- **THEN** no additional instance or volume SHALL be created, the existing instance SHALL be
  adopted (by its unique id, not an eventually-consistent list scan), and the existing pod SHALL
  be returned

### Requirement: Isolation between pods

Each pod SHALL have its own compute instance and its own home volume. No two pods SHALL share a
filesystem. Pods SHALL NOT be able to reach each other over the network: a pod MUST NOT open a
connection to another pod's address on the shared pod bridge, so one tenant cannot reach another
tenant's unauthenticated pod-agent (the "network is the boundary" trust model holds only if that
boundary is enforced). The gateway→pod control path, pod→host DNS/DHCP, and pod→internet egress
SHALL remain unaffected.

The Incus host enforces this at L2, because pods share one bridged `/24` and `br_netfilter` is not
loaded — so pod↔pod traffic is pure L2 bridging and never traverses the ip `FORWARD` chain (an
iptables/ufw FORWARD rule is a no-op). Isolation is an nftables **bridge**-family chain
(`hook forward`) that drops intra-subnet forwards on the pod bridge; it is installed durably by
`bootstrap-box.sh` as the `podbay-isolation` systemd unit and applies to all current and future
pods (matched by subnet, not per-instance).

#### Scenario: Distinct filesystems

- **WHEN** two pods are provisioned
- **THEN** each SHALL have a distinct home volume, and neither SHALL be able to read the other's
  filesystem

#### Scenario: A tenant cannot reach another tenant's pod over the network

- **WHEN** a pod attempts to open a connection to another pod's address (e.g. its pod-agent port)
  on the shared pod bridge
- **THEN** the host SHALL drop the traffic (default-deny cross-pod), WHILE gateway→pod control,
  pod→host DNS/DHCP, and pod→internet egress continue to work

### Requirement: Home volume is a separate block device mounted at /home/dev

The pod's `/home/dev` workspace SHALL live on a SEPARATE per-pod custom volume, distinct from the
instance's root disk, so it survives instance recreation (the upgrade flow). New volumes SHALL be
created as BLOCK volumes (native ext4) and attached with NO `path` (Incus forbids a path on a
block custom volume); an in-guest `podbay-home-mount` service SHALL format the volume ext4 on
first boot and mount it at `/home/dev` before the agent starts. The provider's disk-device
resolution SHALL be content-type aware: a LEGACY `filesystem` (9p-shared) volume still REQUIRES a
`path`, so recreating an older pod SHALL keep working.

#### Scenario: New pod uses a block home volume

- **WHEN** a new pod is provisioned
- **THEN** its home volume SHALL be a block (ext4) custom volume attached without a `path`, and
  the in-guest mount service SHALL mount it at `/home/dev` before the agent starts

#### Scenario: Legacy filesystem volume keeps its path

- **WHEN** a pod whose home volume is a legacy `filesystem` (9p) volume is recreated (e.g. via an
  image update)
- **THEN** the home disk device SHALL be attached WITH a `path` of `/home/dev`, so the legacy pod
  still mounts correctly

### Requirement: Persistent filesystem across suspend and instance replacement

A pod's home volume SHALL persist its contents across suspend/resume and across instance
replacement, so the user's workspace and the in-pod CLI login survive.

#### Scenario: Survives suspend/resume

- **WHEN** a pod is suspended and later resumed
- **THEN** files written before suspend SHALL still be present after resume

#### Scenario: Survives instance replacement

- **WHEN** a pod's compute instance is replaced (e.g. an image update that recreates the instance)
  but its home volume is retained and reattached
- **THEN** the workspace contents, the agent's plan/data, and the in-pod CLI login SHALL remain
  intact

### Requirement: Explicit suspend and resume with keep-awake

`sleep` and `wake` SHALL implement the EXPLICIT user "suspend" and "resume" verbs — a plain
stop/start of the instance — NOT an idle-triggered auto-sleep. There is no automatic idle sweep.
Suspend frees the box's reserved CPU/RAM while the data persists on the separate home volume;
resume is a cold boot where the in-pod agent resumes via `claude --continue`. A `keepAwake` flag
SHALL be settable via `setKeepAwake` so a pod stays up (e.g. during an active Remote Control
session).

#### Scenario: Suspend then resume

- **WHEN** `sleep` is called and then `wake`
- **THEN** the pod SHALL stop (freeing its reserved compute) and later cold-boot back to running,
  with the workspace and login intact and the agent resuming its prior conversation

#### Scenario: keepAwake is recorded

- **WHEN** `setKeepAwake(id, true)` is called
- **THEN** the keep-awake flag SHALL be persisted on the pod and reflected in its `PodInfo`, so
  the control plane's idle policy does not suspend it

### Requirement: Resize reserved compute and grow the home volume

`resize` SHALL change a pod's reserved CPU/RAM and (grow-only) disk. It SHALL apply the change
with a brief suspend (stop → reconfigure limits + grow the home volume → start if it was running),
since reserved limits cannot change on a running instance. Disk SHALL only grow; callers pass the
high-water-mark diskGb. A provider that cannot resize SHALL throw a `ProviderError` with code
`unsupported`.

#### Scenario: Resize a running pod

- **WHEN** `resize(id, resources)` runs on a running pod
- **THEN** the pod SHALL be briefly stopped, its CPU/RAM limits reconfigured, its home volume
  grown to the requested (larger) size, and then restarted

### Requirement: Update image in place keeping the volume

`updateImage` SHALL move a pod to a new base image while retaining and reattaching its home
volume, so `~/work`, the agent's data, and the in-pod CLI login all survive. A running pod SHALL
cold-restart (the live conversation ends; the agent resumes via `claude --continue`); a suspended
pod SHALL be left stopped so the update applies on its next start (never waking a suspended pod
just to update it).

An update SHALL also deliver the environment's CURRENT `.claude` config layer (when the caller
supplies it) and clear the volume's seed marker before restarting the agent, so the in-pod seed
re-runs and skills/rules shipped after the pod's creation reach it. Rationale: the recreate wipes
the layer's staging path on the ephemeral rootfs while the persistent volume still carries the
seed-once marker — without this, an image update NEVER refreshed the config layer (found live
2026-07-28). Layer delivery is best-effort: its failure SHALL NOT fail the image update.

An update SHALL also refresh the pod's DB-derived display name (`podName`) in the preserved pod-spec
from the current pod record, rather than keeping the value the pod was created with. The spec is
otherwise preserved verbatim across the recreate, which froze a dashboard rename — the in-pod greeter
re-applies `podName` as the agent-app session title on every fresh session, so a stale value reverted
the owner's rename after each update (owner report 2026-08-30).

#### Scenario: Update preserves the workspace

- **WHEN** `updateImage(id, image)` runs on a running pod
- **THEN** the instance SHALL be replaced from the new image, the same home volume SHALL be
  reattached, and the workspace plus login SHALL remain intact after the pod restarts

#### Scenario: Update refreshes the config layer

- **WHEN** `updateImage` runs on a running pod with a supplied current `.claude` layer
- **THEN** the provider SHALL push the layer, clear the seed marker, and restart the agent after
  both — so the seed re-runs with the fresh layer present

#### Scenario: Update refreshes the display name

- **WHEN** `updateImage` runs on a pod whose display name was changed (in the dashboard) after creation
- **THEN** the preserved pod-spec's `podName` SHALL be set to the current name, so the agent-app session
  title reflects the rename rather than reverting to the launch-time name

#### Scenario: Layer delivery fails

- **WHEN** pushing the layer or clearing the marker fails
- **THEN** the image update SHALL still complete, and the pod keeps its existing layer

### Requirement: Config and setup injection at first boot

On first provision the provider SHALL seed the pod with the environment's `.claude/` config layer,
the resolved permission preset, and the pod-spec, and SHALL run the environment's `setup` steps
once before the agent CLI is available. It SHALL NOT inject model credentials.

#### Scenario: Config seeded once

- **WHEN** a pod is first provisioned from a `ResolvedPod` with a `.claude/` layer and setup steps
- **THEN** the `.claude/` config, permission preset, and pod-spec SHALL be present in the pod and
  the setup steps SHALL have run before first agent start; a later resume SHALL NOT re-run setup

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

`destroy` SHALL remove both the compute instance and the home volume for a pod, leaving no billable
resources behind.

#### Scenario: Destroy is complete

- **WHEN** `destroy(id)` completes
- **THEN** neither the instance nor the home volume for that pod SHALL remain, and `getPod(id)`
  SHALL report the pod as gone
