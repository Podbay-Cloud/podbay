# egress-allowlist Specification

## Purpose
Enforces a pod's outbound network access against its effective allowlist — permitting allowed hosts, blocking the rest, and leaving the `full` policy unrestricted — in a way the agent cannot bypass (no sudo, no proxy-skipping direct egress). It guarantees the agent CLI keeps working under any policy.
## Requirements
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


### Requirement: Sanctioned fetch endpoints are allowlist-eligible

When an environment enables web-fetch, the reader-service and relay hosts it uses SHALL be
expressible in its egress allowlist, so the capability operates under egress enforcement rather than
being silently blocked by it. Enabling web-fetch SHALL NOT implicitly widen egress — the hosts are
declared like any other allowlist entry.

#### Scenario: Locked-down env with web-fetch

- **WHEN** an env with a restrictive egress policy enables web-fetch and lists the reader/relay hosts
- **THEN** requests to those hosts SHALL pass, and requests to other hosts SHALL remain blocked
