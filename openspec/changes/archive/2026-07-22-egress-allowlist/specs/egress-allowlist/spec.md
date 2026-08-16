## ADDED Requirements

### Requirement: Egress is enforced to the effective allowlist

A pod whose environment policy is not `full` SHALL restrict outbound network access to the
effective domain allowlist (the always-on base plus the policy's additions); all other outbound
destinations SHALL be blocked.

#### Scenario: An allowed host is reachable

- **WHEN** a process in the pod connects to a host on the effective allowlist (e.g. a package
  registry under `trusted`, or the agent's own API endpoint under any policy)
- **THEN** the connection succeeds through the proxy

#### Scenario: A disallowed host is blocked

- **WHEN** a process connects to a host NOT on the allowlist
- **THEN** the connection is refused (no data leaves the pod to that host)

#### Scenario: `full` policy is unrestricted

- **WHEN** the environment policy is `full`
- **THEN** no egress restriction is applied and behavior is unchanged

### Requirement: The agent cannot bypass enforcement

The enforcing rules SHALL be set by root at first boot and SHALL NOT be reversible by the pod's
unprivileged `dev` user (which runs the agent).

#### Scenario: The agent has no sudo under enforcement

- **WHEN** an enforcing policy (not `full`) is active
- **THEN** the `dev` user has no sudo, and cannot flush iptables, stop the proxy, or otherwise
  restore unrestricted egress

#### Scenario: Direct egress bypassing the proxy is blocked

- **WHEN** the agent attempts a direct outbound connection (not via the proxy) to any host
- **THEN** iptables drops it — the proxy is the only path out

### Requirement: The agent CLI keeps working under any policy

The base allowlist SHALL always include the endpoints the agent CLI needs (its API + DNS), so the
agent functions even under `none`.

#### Scenario: Agent works under a restrictive policy

- **WHEN** the policy is `none` or `custom` without the AI endpoints listed
- **THEN** the agent can still reach its own API (base allowlist) and operate
