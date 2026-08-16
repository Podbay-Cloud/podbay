## ADDED Requirements

### Requirement: Sanctioned fetch endpoints are allowlist-eligible

When an environment enables web-fetch, the reader-service and relay hosts it uses SHALL be
expressible in its egress allowlist, so the capability operates under egress enforcement rather than
being silently blocked by it. Enabling web-fetch SHALL NOT implicitly widen egress — the hosts are
declared like any other allowlist entry.

#### Scenario: Locked-down env with web-fetch

- **WHEN** an env with a restrictive egress policy enables web-fetch and lists the reader/relay hosts
- **THEN** requests to those hosts SHALL pass, and requests to other hosts SHALL remain blocked
