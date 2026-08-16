## ADDED Requirements

### Requirement: Pods are sized against the real host, not cloud tiers

In the OSS edition, pod creation SHALL let the owner choose the pod's real CPU and memory instead of
cloud size tiers, defaulting to no explicit limit (the pod uses what it needs). The local provider
SHALL enforce a chosen limit via container resource controls (`--cpus`, `--memory`), and metrics for
a limited pod SHALL reflect the container's own usage rather than the whole host.

#### Scenario: Choosing CPU and memory bounds the pod

- **WHEN** the owner creates an OSS pod and sets a CPU and/or memory value
- **THEN** the provider SHALL run the container with the matching `--cpus`/`--memory` limits, and the
  pod's reported memory metric SHALL be its cgroup usage against that limit (not the host total)

#### Scenario: The default is unlimited and unchanged

- **WHEN** the owner creates an OSS pod without setting a limit
- **THEN** the pod SHALL run with no CPU/memory cap (identical to prior behavior), and its metrics MAY
  report host-relative values as before

### Requirement: The sizing UI reflects host capacity

The OSS pod-creation UI SHALL surface the Docker host's capacity: its total CPU and memory, the
amount already committed to running podbay pods, and what remains. It SHALL warn when a chosen size
exceeds what's free but SHALL NOT hard-block the owner from deliberately overcommitting their own
machine.

#### Scenario: Free capacity is shown and over-allocation warns

- **WHEN** the owner opens the OSS sizing UI
- **THEN** it SHALL show total, committed-to-pods, and free CPU/memory from the host, and if the
  owner picks more than is free it SHALL warn while still permitting the launch
