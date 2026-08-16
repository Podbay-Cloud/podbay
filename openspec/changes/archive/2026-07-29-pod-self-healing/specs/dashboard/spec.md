## ADDED Requirements

### Requirement: The cockpit surfaces pod health only when it is bad

The cockpit SHALL render a health strip in the ready state when the pod reports issues, and SHALL
render nothing when it reports none — a healthy pod's cockpit stays the clean agent-card stack, so
the strip's presence is itself the signal. Per-agent problems SHALL stay on that agent's card (the
existing state machine); the strip carries pod-level issues: disk, session, scheduler, app port, and
"automatic repair gave up".

The full check list, the last run, and a manual "Run doctor" SHALL live in the Admin tab, consistent
with the terminal living there: routine use never meets the machinery.

#### Scenario: Healthy pod

- **WHEN** the pod reports no issues
- **THEN** the ready state SHALL show no health strip and no doctor prompt

#### Scenario: A pod-level problem

- **WHEN** the pod reports a pod-level issue such as low disk
- **THEN** the strip SHALL name it, its severity SHALL be visible at a glance, and a fix SHALL be
  offered when one exists

#### Scenario: Repair gave up

- **WHEN** automatic repair has exhausted its cap for a target
- **THEN** the cockpit SHALL say so with the reason, rather than leaving a card in a state that
  looks transient

### Requirement: Doctor runs from the cockpit with a visible result

The Admin tab SHALL let the owner run doctor and SHALL show its progress and result — which checks
ran, which failed, what was fixed — rather than a spinner that ends in a toast. Applying invasive
fixes SHALL require confirmation that states what will be changed and that the previous file is
backed up.

#### Scenario: Running doctor

- **WHEN** the owner runs doctor from the Admin tab
- **THEN** the checks and their outcomes SHALL be shown, with any applied fixes named

#### Scenario: Nothing to fix

- **WHEN** every check passes
- **THEN** the result SHALL say the pod is healthy, and no fix action SHALL be offered
