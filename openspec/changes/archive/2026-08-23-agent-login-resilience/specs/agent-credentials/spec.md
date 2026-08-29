## ADDED Requirements

### Requirement: A running pod's agent login is kept fresh before it can hard-expire

An agent's OAuth refresh token has a hard expiry (~27–30 days) and only refreshes while the agent is
actively used. The platform SHALL prevent a **running** pod's login from silently passing that expiry
by triggering a token refresh for an agent that has been idle long enough to be at risk. This SHALL
NOT be limited to suspended pods, and SHALL apply to both cloud (Incus) and self-host (`local`) pods,
neither of which idle-sleeps.

#### Scenario: A long-idle running agent is refreshed before expiry

- **WHEN** a running pod's agent has been idle beyond the refresh threshold and its login has not yet
  hard-expired
- **THEN** the platform triggers a trivial non-interactive agent invocation that forces the agent's
  on-demand token refresh, and the refreshed credential is written to the pod's own volume

#### Scenario: An actively-used agent is not disturbed

- **WHEN** a pod's agent is reporting `busy`/`shell` or has been idle less than the refresh threshold
- **THEN** the platform does not trigger a refresh for it (its token is already fresh from use)

#### Scenario: A refresh that cannot succeed does not mask the failure

- **WHEN** a refresh is attempted but the login has already hard-expired (or the pod is unreachable)
- **THEN** the pod continues to report `loginExpired`, the owner-facing "sign-in expired" state and
  Reconnect path remain available, and the refresh outcome is recorded so a persistently-failing pod
  is visible in the fleet view

### Requirement: Keeping the login fresh is the mechanism; a failing keepalive is surfaced as a fault

Keeping the token fresh (the refresh keepalive) is the primary, expected mechanism — a healthy
running pod's login SHALL NOT drift toward hard expiry, and the owner SHALL NOT be routinely asked to
re-authenticate a running pod. The platform SHALL treat an approaching expiry on a running pod ONLY
as a signal that the keepalive is **failing** (a fault to fix), never as a routine reminder the owner
must act on. Terminal expiry remains handled by the existing `loginExpired` detection + Reconnect.

#### Scenario: A healthy running pod never warns about expiry

- **WHEN** a running pod's refresh keepalive is working and its login is being kept fresh
- **THEN** no expiry warning is shown — the owner is never asked to babysit the token

#### Scenario: A failing keepalive is surfaced as a fault

- **WHEN** a running, reachable pod's login is approaching hard expiry DESPITE the keepalive (refresh
  is failing or is not reaching that pod)
- **THEN** the platform raises a fault-level signal that the sign-in could not be kept fresh, so it
  can be fixed before it expires — distinct from a routine "please reconnect" nudge

#### Scenario: Suspended pod is not warned

- **WHEN** a pod is suspended and its login is approaching or past expiry
- **THEN** no proactive expiry warning is raised for it; its expired state is surfaced instead on its
  next wake via the existing `loginExpired` detection

### Requirement: A lapsed login recovers to the correct state on wake and via reconnect

A suspended pod is expected to lapse. On wake, the platform SHALL bring it to the correct, honest
state — reporting `loginExpired` rather than a false-healthy `idle` — and SHALL offer an explicit
owner-driven reconnect that restores the login without recreating the pod.

#### Scenario: A suspended-then-woken pod reports its expired login

- **WHEN** a pod whose login lapsed while suspended is woken
- **THEN** its `/healthz` reports `authed:false` and `loginExpired:true`, the `agent-login-expired`
  health issue is raised, and the dashboard surfaces the "sign-in expired" state — never "idle"

#### Scenario: Owner reconnects a lapsed agent

- **WHEN** the owner triggers Reconnect for an agent whose login expired
- **THEN** the platform clears the dead credential and restarts the agent into its login flow so the
  owner can re-authenticate, without destroying or recreating the pod

### Requirement: Login-expiry detection and refresh are agent-agnostic

The detect / warn behavior SHALL apply equally to every supported agent (Claude Code and Codex),
reading each agent's own credential file and expiry field. A credential that never expires (e.g. a
bare API key) SHALL never be reported as expired. Proactive token REFRESH is Claude-only for now — a
verified-safe headless Codex refresh command is not yet confirmed, so Codex relies on detect + warn +
reconnect rather than an unverified auto-refresh (documented deferral).

#### Scenario: Codex expiry is detected like Claude's

- **WHEN** a pod runs Codex and its `~/.codex/auth.json` OAuth token is past its expiry field
- **THEN** the pod reports `loginExpired` for Codex and is eligible for the same warning and reconnect
  treatment as Claude (auto-refresh remains Claude-only until a safe Codex command is verified)

#### Scenario: A non-expiring credential is never flagged

- **WHEN** an agent is authenticated with a credential that carries no expiry (e.g. an API key)
- **THEN** it is never reported as `loginExpired` and is never selected for refresh
