## MODIFIED Requirements

### Requirement: The relay is operated by the owner, and open by default once running

> SYNCED from `openspec/changes/relay-egress-tunnel` on 2026-08-04, when the tunnel transport
> shipped: one relay now serves BOTH consumers (dispatch-fetch and the egress tunnel).

One running relay SHALL serve both the dispatch-fetch path (page content, and MAY use the owner's
signed-in session for a domain they explicitly logged into) AND the egress-tunnel path (a proxy the
pod's own clients egress through), with no second command — `relay start` powers both. The tunnel
SHALL carry the owner's IP only, NOT their cookies: "fetch as me" stays a dispatch property
(`relay login <site>`).

The relay SHALL run as a program on the owner's machine and SHALL NOT serve any request until the owner
has acknowledged, on that machine, what it does and that it fetches from their network.

Once running, a pod MAY fetch the PUBLIC web through the relay without per-request approval or a
maintained allowlist. The owner MAY locally pause a pod or block a site; those explicit denials SHALL
override the open-by-default behavior until removed. Oversight is after the fact: every fetch SHALL be
recorded in a local audit the owner can read, including gateway-authoritative pod attribution when
available, and the platform SHALL surface only its existing coarse relay activity in the admin
dashboard.

The platform SHALL NOT persist the owner-local event path, pod attribution, or detailed history. Adding
source metadata to an owner-bound relay frame SHALL NOT add that metadata to platform telemetry or the
database.

Two protections remain, and both protect the OWNER:

- The relay SHALL refuse any target that is not a public web address — a bare IP, a loopback or private
  range, or a LAN name — so a compromised pod cannot make the owner's machine reach their own network.
  A redirect onto such a target SHALL be refused too.
- Whether a fetch uses the owner's signed-in session SHALL be opt-in per site. A domain the owner has
  explicitly signed into SHALL be fetched as them; every other domain SHALL be fetched in a clean,
  cookieless context. So a pod fetching a site the owner never lent gets a logged-out page, not the
  owner's account.

The relay SHALL return page content only, never a cookie or stored session. It SHALL bound how many
pages it opens at once, and a fetch over that bound SHALL wait rather than be refused. It SHALL survive
a transient disconnect by reconnecting, so a network blip does not require the owner to restart it.

#### Scenario: A pod fetches a public page

- **GIVEN** the owner has not paused the pod or blocked the site
- **WHEN** the relay is running and the pod fetches a public web page it was not specifically pre-authorised for
- **THEN** it SHALL be served from a clean context and recorded in the local audit with that pod's gateway-authoritative id when available

#### Scenario: A pod targets the owner's own network

- **GIVEN** the relay is running
- **WHEN** a fetch resolves to localhost, a private IP range, or a LAN name
- **THEN** it SHALL be refused

#### Scenario: A site the owner signed into

- **GIVEN** the owner has not revoked signed-in access for the site
- **WHEN** the owner has signed into a site and a pod fetches it
- **THEN** it SHALL be fetched using the owner's session and other sites SHALL NOT use that session

#### Scenario: Owner-local pod denial

- **GIVEN** the owner has paused one pod in the local relay dashboard
- **WHEN** that pod requests a fetch or tunnel connection
- **THEN** the relay SHALL refuse it before browser or socket work while requests from non-paused sibling pods remain eligible

#### Scenario: Detailed attribution stays local

- **GIVEN** the gateway sends a pod-attributed request to the owner's relay
- **WHEN** the relay completes and records the event
- **THEN** the pod id and safe target detail MAY be retained on the owner's computer but SHALL NOT be added to Podbay's persisted relay telemetry
