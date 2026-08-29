## ADDED Requirements

### Requirement: A maintenance interrupt communicates its bounded wait as progress

An owner-initiated interrupt (update/resize) waits — by design, for data safety — on a bounded
handoff and a graceful guest shutdown before any force-stop. Those waits are legitimate and
time-boxed, but today render as a motionless "Stopping the pod", indistinguishable from a hang. The
platform SHALL communicate each bounded wait as determinate progress: name the handoff phase
distinctly, and show the graceful-shutdown wait against its known maximum so the owner sees the pod
is safely finishing, not stuck.

#### Scenario: The handoff phase is shown distinctly, not as "Stopping"

- **WHEN** an update is in its handoff phase
- **THEN** the progress UI shows a distinct "handing off" step (not the "Stopping the pod" step) and
  the progress indicator reflects that phase

#### Scenario: The graceful-shutdown wait shows elapsed against its maximum

- **WHEN** the pod is in the graceful-shutdown wait before any force-stop
- **THEN** the progress UI communicates that it is waiting for a clean shutdown and shows the elapsed
  time against the known bounded maximum, rather than a frozen spinner with a caption already exceeded

#### Scenario: A slow-but-bounded shutdown never reads as stuck

- **WHEN** a graceful shutdown legitimately takes close to its full bounded time (e.g. a wedged agent)
- **THEN** the owner sees continuous, honest progress toward the bound and the force-stop that follows,
  and is not led to believe the pod has hung
