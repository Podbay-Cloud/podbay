## ADDED Requirements

> Note: the verifier requirement below was SYNCED into `openspec/specs/web-fetch/spec.md` on
> 2026-07-30 when section 1 shipped. It stays here so the change reads as a whole; the rest of this
> delta is not built yet.

### Requirement: A rung's result is verified before it is believed

Every rung SHALL validate its result before returning it, and a result that fails validation SHALL
advance the ladder rather than be reported as content.

Transport success is not content success. Measured from a pod: a reader service returned HTTP 200
carrying the target site's "you've been blocked by network security" page. An unverified ladder reports
that as the answer — confidently, and wrongly, which is worse than reporting nothing.

Validation SHALL check, in increasing cost: transport status and redirect destination; known soft-block
signatures served with a success status; content plausibility against a length and structure floor; and
last, relevance to what was requested. Relevance SHALL warn rather than reject, because it is the only
check that can discard a correct fetch.

#### Scenario: A block page served as a success

- **WHEN** a rung returns HTTP 200 whose body is a block, challenge, or login page
- **THEN** the result SHALL be rejected and the next rung attempted

#### Scenario: An empty shell

- **WHEN** a page renders to less content than the plausibility floor
- **THEN** the result SHALL be rejected rather than summarised as the page

### Requirement: A real browser rung, telling the truth about itself

The ladder SHALL include fetching with a real browser engine, which renders JavaScript. It SHALL NOT
attempt to disguise itself: no user-agent spoofing, no fingerprint or canvas manipulation, no
automation-hiding.

This rung exists for RENDERING, not for access. Measured: a real browser with an honest identity
received a byte-identical refusal to a plain request from the same address, because the refusal happens
at the network edge before any fingerprint is read — so disguise would spend effort on a layer that is
never reached, in exchange for becoming evasion.

#### Scenario: A JavaScript-rendered page

- **WHEN** a page returns a shell to a plain request but renders content in a browser
- **THEN** the browser rung SHALL return the rendered content

#### Scenario: A source that refuses this network

- **WHEN** a source refuses the pod's address
- **THEN** the browser rung SHALL report the refusal and SHALL NOT retry with an altered identity

### Requirement: The platform remembers which rung works for which domain

The platform SHALL maintain a shared record of fetch outcomes per domain and rung, readable by pods
before they climb the ladder and written back after each attempt, so an outcome is learned once for the
fleet rather than rediscovered per task and per pod.

Negative outcomes SHALL be recorded and honoured: knowing a domain refuses this network saves the entire
ladder, which is most of the value.

A verdict SHALL carry a last-verified time and expire, so a refusal recorded once does not become
permanent, and SHALL be re-verifiable on demand by an operator.

The record SHALL store the registrable domain, the rung, and the outcome only. It SHALL NOT store full
URLs, fetched content, or which pod or owner made the request — the record is a capability map, and
without that boundary a shared one would be a fleet-wide log of what every owner researches.

Pods SHALL cache the record locally, so an unreachable control plane degrades to a stale plan rather
than no fetching.

#### Scenario: A domain already known to refuse this network

- **WHEN** an agent is asked to read a domain recorded as network-refused
- **THEN** it SHALL go to the rung that works for that domain rather than climbing from the bottom

#### Scenario: A stale verdict

- **WHEN** a recorded verdict is older than its expiry
- **THEN** it SHALL be re-verified rather than trusted

### Requirement: The relay is the owner's own access, not a proxy

The platform SHALL support an owner-operated relay that performs a fetch from the OWNER's machine, for
sources that refuse the pod's network.

It SHALL be opt-in, limited to domains the owner allowlists, rate-limited on both the requesting and
serving side, and stoppable by the owner at any time. It SHALL use a browser profile belonging to the
relay, which the owner signs into deliberately — never the owner's everyday browser profile, which would
expose every credential they hold to a pod.

The relay SHALL connect outbound from the owner's machine, requiring no inbound port, tunnel, or
third-party service.

When no relay is connected, or a domain is not allowlisted, the rung SHALL report itself unavailable. It
SHALL NOT fall back to re-attempting the source from the pod — that is the evasion the ladder exists to
avoid.

Because the owner's machine is not always awake, relay requests SHALL queue with a visible pending state
and callers SHALL degrade honestly, reporting which sources were read and which await the relay.

Enabling the relay SHALL state plainly that automating a signed-in session may breach a site's terms and
that the account at risk is the owner's.

#### Scenario: Relay not connected

- **WHEN** a fetch needs the relay and none is connected
- **THEN** the request SHALL queue and the caller SHALL report the source as pending, not failed silently

#### Scenario: A domain outside the allowlist

- **WHEN** a relay fetch is requested for a domain the owner has not allowlisted
- **THEN** it SHALL be refused, and the source SHALL NOT be attempted from the pod instead

#### Scenario: An expired signed-in session

- **WHEN** the relay's profile no longer holds a valid session for a domain
- **THEN** the login wall SHALL be detected as a failed verification and reported as needing the owner to
  sign in again
