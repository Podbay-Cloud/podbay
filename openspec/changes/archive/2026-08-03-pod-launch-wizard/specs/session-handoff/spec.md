## ADDED Requirements

### Requirement: A once-per-pod walkthrough explains how to connect

When a pod first reaches the ready state, the cockpit SHALL offer a short guided walkthrough of how to
connect to the pod's agent. It SHALL explain that the owner can open the session **in the browser or in
their Claude desktop app** to see the agent running on the pod, and — for advanced use — connect via the
**terminal in the Admin tab**. The walkthrough SHALL be presented as anchored coach-marks — a popover
pointing at the relevant control — advanced with Next/Back and dismissed with Done. It SHALL be shown at
most once per pod, persisted so it does not reappear on later visits or other devices.

#### Scenario: First arrival at ready

- **WHEN** the owner first views a pod that has become ready and has not seen the walkthrough
- **THEN** the walkthrough SHALL run, each step pointing at the control it describes, and it SHALL name
  both the web and Claude-desktop-app ways to open the session

#### Scenario: Already seen

- **WHEN** the owner returns to a pod whose walkthrough has been completed
- **THEN** the walkthrough SHALL NOT reappear

### Requirement: Continue-in-Claude opens the web session reliably

The "Continue in Claude" action SHALL open the session's web URL (`https://claude.ai/code/session_…`)
in a new tab, and SHALL remain an ordinary link so keyboard, middle-click, and modified-click behave
normally. On platforms where the OS routes that URL to an installed Claude app (e.g. mobile universal
links), the app opens; the capability SHALL NOT attempt to force a desktop app via an undocumented URL
scheme, because a browser click cannot reliably reach the app and a wrong scheme degrades the
experience (e.g. a browser error dialog). The walkthrough tells the owner they may open the same
session in their desktop app.

#### Scenario: Clicking Continue in Claude

- **WHEN** the owner clicks Continue in Claude
- **THEN** the session's web URL SHALL open in a new tab (the reliable, cross-platform behavior)
