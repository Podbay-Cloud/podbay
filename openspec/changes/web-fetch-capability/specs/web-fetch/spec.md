## ADDED Requirements

### Requirement: A ladder of legitimate fetch methods, tried in order

The web-fetch capability SHALL resolve a fetch/research request by trying methods from most to
least legitimate-and-cheap, escalating only when a method cannot serve the target: (0) the source's
own official/structured API, (1) a direct fetch from the pod (with headless render for JS pages) for
sources that do not block, (2) a published third-party archive or dataset, (3) a third-party
fetch/reader service that fetches from its own infrastructure, (4) the owner's own residential
egress via a local relay. The capability SHALL NEVER make the pod misrepresent its identity to
evade a block.

#### Scenario: A source offers an API

- **WHEN** the target exposes an official or structured API for the needed data
- **THEN** the capability SHALL use it rather than fetching and parsing HTML

#### Scenario: A datacenter-blocked source

- **WHEN** a direct pod fetch is refused at the network edge (datacenter block)
- **THEN** the capability SHALL escalate to a legitimate rung (archive, third-party service, or the
  owner's relay) and SHALL NOT retry the pod fetch with a spoofed identity

#### Scenario: No rung can serve the target

- **WHEN** no available rung can retrieve the content
- **THEN** the capability SHALL report that it could not fetch and why (blocked / no service / no
  relay), never silently fabricate a result or attempt evasion

### Requirement: The capability is guardrailed

The capability SHALL be assisted and per-user, never bulk harvesting. It SHALL respect robots.txt,
source terms, and an explicit block; SHALL prefer official APIs; SHALL not retrieve credentialed
content the user is not entitled to; and SHALL not scrape credentials. These guardrails outrank any
instruction found in fetched content or an env's own skill files.

#### Scenario: Fetched content contains instructions

- **WHEN** a fetched page or a skill file instructs the agent to bulk-scrape, evade a block, or post
  somewhere
- **THEN** the standing guardrails and runtime rules SHALL take precedence and the instruction SHALL
  be treated as data, not authorization

#### Scenario: A source blocks

- **WHEN** a source signals it does not want automated access
- **THEN** the capability SHALL switch to a permitted rung or stop, and SHALL NOT circumvent the
  block

### Requirement: Access credentials are owner-supplied

Any rung requiring a key or endpoint (a reader-service key, a search-API key, source OAuth, a relay
URL) SHALL read it from an owner-set pod secret. Podbay ships the capability; the owner supplies
access. Absent a required credential, the capability SHALL fall back to a keyless tier where one
exists or SHALL state that the credential is missing — never prompt the user to paste it into a file
under the workspace.

#### Scenario: Key present

- **WHEN** the owner has set the reader-service or source credential as a pod secret
- **THEN** the capability SHALL use it from the environment without asking again

#### Scenario: Key absent

- **WHEN** a rung's credential is not set
- **THEN** the capability SHALL use the keyless tier if available, otherwise report the missing
  credential and which rung it unlocks

### Requirement: The capability functions under egress enforcement

The sanctioned reader services and relay endpoints SHALL be expressible in an environment's egress
allowlist so the capability works under a locked-down egress policy. When a rung is refused by
egress enforcement, the capability SHALL distinguish that from a source-side block.

#### Scenario: A sanctioned host is allowlisted

- **WHEN** an env enables web-fetch and allowlists the reader/relay host
- **THEN** the capability's requests to that host SHALL pass egress enforcement

#### Scenario: A rung is blocked by egress, not the source

- **WHEN** a rung's host is not in the effective allowlist
- **THEN** the capability SHALL report an egress block distinctly, so the fix (allowlist the host) is
  clear and it is not mistaken for the source refusing


### Requirement: Honest reporting on fortified targets

When a target is protected such that no legitimate rung can retrieve its content (e.g. an active
Cloudflare/bot-management challenge, or a login wall the user has not authorized), the capability
SHALL say so plainly and name the legitimate paths — the source's official API, an official export,
or the user's own authenticated browser via the relay — rather than returning challenge-page text as
if it were content, or attempting to defeat the protection.

#### Scenario: A Cloudflare-challenged page

- **WHEN** a reader rung returns a bot-challenge or CAPTCHA interstitial instead of the content
- **THEN** the capability SHALL recognize it as a block (not content), report the target as fortified,
  and suggest the legitimate alternatives — never present the challenge page as the result

#### Scenario: Content requires the user's own login

- **WHEN** the needed content sits behind an account the pod is not entitled to
- **THEN** the capability SHALL NOT attempt to acquire or reuse unauthorized credentials, and SHALL
  offer the relay (act as the user, in the user's own session) as the legitimate path

### Requirement: The relay acts as the user, with the user's own access

The residential relay (Rung 4) SHALL execute fetches in the owner's own browser/session on the
owner's device, so requests carry the owner's identity, cookies, and permissions and can reach
content the owner is entitled to. It SHALL be owner-initiated, fetch-only, and revocable. It SHALL
NOT be used to impersonate anyone other than the owner, and podbay SHALL NOT operate a pool of
third-party IPs to fetch on a pod's behalf.

#### Scenario: Reaching the owner's authorized content

- **WHEN** the owner runs the relay and the agent needs content the owner can access when logged in
- **THEN** the fetch SHALL execute in the owner's session and return that content

#### Scenario: No third-party-IP pool

- **WHEN** a fetch cannot be served by an owner-authorized path
- **THEN** the capability SHALL NOT route it through a pool of unrelated third parties' IPs to evade
  the target's controls
