## ADDED Requirements

### Requirement: Pod persistence via a store abstraction

The control plane SHALL persist pod records through a `PodStore` abstraction (create, get,
list-by-owner, update, delete). The service SHALL depend on the interface, not a concrete store,
so it runs against an in-memory store in tests and a database store in production.

#### Scenario: Records survive and are retrievable

- **WHEN** a pod record is created in the store
- **THEN** it SHALL be retrievable by its id and appear in its owner's list

#### Scenario: Service is store-agnostic

- **WHEN** the `PodService` is constructed
- **THEN** it SHALL accept any `PodStore` implementation and any `SandboxProvider`

### Requirement: Launch a pod from an environment

`launchPod(ownerId, environmentName)` SHALL resolve a first-party environment (via
`@podbay/shared`), provision a pod through the provider, and persist a record linking the pod to
its owner and environment.

#### Scenario: Successful launch

- **WHEN** `launchPod` is called with a valid environment name
- **THEN** the provider SHALL be asked to create a pod, a record SHALL be stored with the owner,
  environment, pod id, and initial status, and the record SHALL be returned

#### Scenario: Unknown environment is rejected

- **WHEN** `launchPod` is called with an environment that does not resolve
- **THEN** it SHALL fail without creating any provider resource or store record

### Requirement: Ownership isolation

Pod queries SHALL be scoped to an owner. A user SHALL only see and control their own pods.

#### Scenario: List returns only the owner's pods

- **WHEN** two owners each launch pods and one owner lists pods
- **THEN** only that owner's pods SHALL be returned

#### Scenario: Cross-owner access is denied

- **WHEN** an owner requests or mutates a pod they do not own
- **THEN** the operation SHALL be denied (treated as not found)

### Requirement: Lifecycle operations delegate and record

`wake`, `sleep`, `setKeepAwake`, and `destroy` SHALL delegate to the provider and update the
stored record accordingly. Activity SHALL update `lastActiveAt`.

#### Scenario: Wake updates activity and status

- **WHEN** an owner wakes a pod
- **THEN** the provider SHALL be asked to wake it, and the record's status and `lastActiveAt`
  SHALL be updated

#### Scenario: Destroy removes the record

- **WHEN** an owner destroys a pod
- **THEN** the provider SHALL tear it down and the store record SHALL be removed

### Requirement: keepAwake propagation

Setting `keepAwake` SHALL update both the provider and the stored record, and the idle policy
SHALL respect it.

#### Scenario: keepAwake is persisted

- **WHEN** an owner sets `keepAwake` true on a pod
- **THEN** the provider SHALL be told and the record SHALL reflect `keepAwake = true`

### Requirement: Idle-to-sleep policy

The control plane SHALL provide a method that identifies pods idle beyond a threshold and sleeps
them, skipping any pod with `keepAwake` set. Running it on a schedule is the host's concern.

#### Scenario: Idle pod is slept

- **WHEN** the idle policy runs and a pod's last activity exceeds the threshold and `keepAwake`
  is false
- **THEN** that pod SHALL be slept via the provider

#### Scenario: keepAwake pod is skipped

- **WHEN** the idle policy runs and an otherwise-idle pod has `keepAwake` true
- **THEN** that pod SHALL NOT be slept

### Requirement: Status reconciliation

The control plane SHALL refresh a stored record's status from the provider's current truth, so
externally-changed states (e.g. a pod that stopped) are reflected.

#### Scenario: Reconcile updates a stale record

- **WHEN** the provider reports a pod's status differs from the stored record
- **THEN** reconciliation SHALL update the record to the provider's status
