## ADDED Requirements

### Requirement: The pod self-documents its runtime via a CLI

Every pod SHALL provide a `podbay` command on PATH that prints the pod's live runtime facts read
from local metadata, so the agent never relies on a hardcoded or drifting description.

#### Scenario: `podbay info` reports the environment

- **WHEN** `podbay info` runs in a pod
- **THEN** it prints the slug, environment name, preview URL, what persists (`~/work` survives
  sleep/wake; everything else resets), egress policy, and the agent

#### Scenario: `podbay preview` reports the URL for a port

- **WHEN** `podbay preview` runs (optionally with a port; default 3000)
- **THEN** it prints the preview URL for that port and notes it is owner-only until made public

### Requirement: Every pod carries universal runtime rules

A podbay-authored runtime-rules document SHALL be present at the user-level `~/.claude/CLAUDE.md`
in every pod, stating the disposable-pod facts and pointing at the `podbay` CLI for live values,
without clobbering a file the user already has.

#### Scenario: Rules are present and point at the CLI

- **WHEN** a pod boots
- **THEN** `~/.claude/CLAUDE.md` exists and references `podbay info` for the environment/preview URL

### Requirement: A running app on port 3000 is reachable at a preview URL

The gateway SHALL serve `<slug>.preview.podbay.cloud` by proxying HTTP and WebSocket traffic to the
pod's port 3000 over the private network, waking the pod on request.

#### Scenario: Owner opens the preview

- **WHEN** the authenticated owner requests the pod's preview URL and an app is listening on 3000
- **THEN** the gateway proxies the response (including WebSocket upgrades for HMR)

#### Scenario: A sleeping pod wakes on preview request

- **WHEN** a preview request arrives for a non-running pod
- **THEN** the gateway wakes the pod and proxies once it is listening

### Requirement: Preview access is owner-authed unless made public

A preview SHALL require the pod owner's authenticated session by default; a per-pod public toggle
SHALL allow unauthenticated access when the owner opts in.

#### Scenario: Non-owner is blocked on a private pod

- **WHEN** a logged-out or non-owner client requests a private pod's preview
- **THEN** the request is rejected

#### Scenario: Public toggle allows anonymous access

- **WHEN** the owner marks the pod public
- **THEN** an unauthenticated client can load the preview
