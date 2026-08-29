## ADDED Requirements

### Requirement: A pod may authenticate Claude with a long-lived setup-token instead of a subscription login

Beyond the default subscription `/login`, a pod MAY be configured to authenticate Claude with a long-lived
`claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`), for unattended/agent pods that do not need Claude's native
Remote Control. This token is **inference-only** (scope `user:inference`) and lasts about a year, so a pod on
it SHALL NOT offer Claude's native "Open in Claude" Remote Control or claude.ai connectors — its remote
control comes from an external harness (T3 Code) driving the CLI. The mode SHALL be explicit about this
tradeoff wherever it is selected, and the token SHALL be stored pod-side only (out of `~/work`, file-mode
restricted, never logged).

#### Scenario: A setup-token pod runs the agent for a year without native RC

- **WHEN** a pod is set to `setup-token` auth and a valid token is stored
- **THEN** the Claude CLI SHALL run agent turns on that token without a subscription `/login`, native Remote
  Control SHALL be presented as unavailable (use T3 instead), and the login SHALL not need renewing until the
  token's ~yearly expiry

### Requirement: Running the agent does not renew a subscription login

Podbay SHALL NOT treat agent activity or the pod merely running as a way to extend a subscription `/login`.
The subscription login has a fixed periodic hard expiry that only a full re-login resets (verified: a
`claude -p` turn and access-token refresh do not move it). Any maintenance that previously implied otherwise
(e.g. an "idle-refresh" sweep) SHALL be removed or clearly marked as not renewing logins, so the system never
reports a login as safe when it is approaching expiry.

#### Scenario: A near-expiry login is not treated as safe because the pod is active

- **WHEN** a pod is running and its subscription login is within its warning window
- **THEN** the expiring-login warning SHALL still fire (no "the pod is active so it's fine" suppression), and
  no maintenance job SHALL claim to have renewed it
