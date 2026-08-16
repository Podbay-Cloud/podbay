## MODIFIED Requirements

### Requirement: The relay is operated by the owner, and open by default once running

One running relay SHALL serve both the dispatch-fetch path (page content, and MAY use the owner's
signed-in session for a domain they explicitly logged into) AND the egress-tunnel path (a proxy the
pod's own clients egress through), with no second command — `pb relay start` powers both. The tunnel
SHALL carry the owner's IP only, NOT their cookies: "fetch as me" stays a dispatch property
(`pb relay login <site>`).

The relay SHALL run as a program on the owner's machine and SHALL NOT serve any request until the owner
has acknowledged, on that machine, what it does and that it fetches from their network.

Once running, the pod MAY fetch the PUBLIC web through the relay without per-request approval — the
owner does not sit and approve fetches. Oversight is after the fact: every fetch SHALL be recorded in a
local audit the owner can read, and the platform SHALL surface relay activity in the admin dashboard.

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

#### Scenario: One command, both consumers

- **WHEN** the owner runs `pb relay start`
- **THEN** both the agent's dispatch fetches AND an app's egress through the tunnel SHALL be served by
  that one relay, without the owner starting anything else

#### Scenario: A pod fetches a public page

- **WHEN** the relay is running and a pod fetches a public web page it was not specifically pre-authorised for
- **THEN** it SHALL be served from a clean context, and the fetch SHALL be recorded in the audit

#### Scenario: A pod targets the owner's own network

- **WHEN** a fetch resolves to localhost, a private IP range, or a LAN name
- **THEN** it SHALL be refused

#### Scenario: A site the owner signed into

- **WHEN** the owner has signed into a site and a pod fetches it
- **THEN** it SHALL be fetched using the owner's session; other sites SHALL NOT

## ADDED Requirements

### Requirement: The relay offers a transparent egress tunnel for the pod's own clients

The relay SHALL offer, alongside dispatch-fetch, a **transparent egress tunnel**: a SOCKS5 proxy the
pod's own programs (a crawler, a browser) point at so their traffic egresses from the owner's network
with the live DOM intact — no content snapshot, no recipe rewrite. The tunnel SHALL be selective: only
clients that use the proxy egress through the owner; all other pod traffic (the agent's own control-plane
calls) SHALL continue to leave from the pod's own address.

The tunnel SHALL carry the same platform-side guards as dispatch: the domain SHALL be derived by the
platform from the connection target (not trusted from the pod); non-public targets SHALL be refused; and
per-domain rate and concurrency SHALL be bounded, with a refused connection not counted against budget.

#### Scenario: An app egresses through the owner's IP with live DOM

- **WHEN** a program in the pod connects through the relay tunnel to a public site that blocks the
  datacenter IP
- **THEN** the connection SHALL egress from the owner's network and the program SHALL receive the live
  response (headers/body/DOM), exactly as if it had fetched directly from the owner's machine

#### Scenario: A private-network target through the tunnel

- **WHEN** a program tries to reach a bare IP, loopback, or private host through the tunnel
- **THEN** the connection SHALL be refused at the platform and at the owner's relay

### Requirement: The pod exposes a pre-wired, fail-closed relay proxy

The pod SHALL export a proxy endpoint (`PODBAY_RELAY_PROXY`) pre-set to a pod-local address, so an app
uses the relay with zero configuration. It SHALL **fail closed**: when no relay is running the endpoint
SHALL refuse connections with a clean error, so the variable is always safe to set and simply inert
until a relay is up. It SHALL NOT be exported as the global `HTTP(S)_PROXY`, so the agent's own
control-plane traffic is never routed through the owner's network.

#### Scenario: Proxy is inert until the relay starts

- **WHEN** an app reads `PODBAY_RELAY_PROXY` and no relay is running
- **THEN** its connection SHALL be refused cleanly (never hang, never silently leave via the datacenter
  IP), and SHALL begin succeeding the moment the owner starts the relay — with no change on the pod

### Requirement: The agent drives the relay; the owner runs one command

Reaching the relay SHALL NOT depend on the owner reading documentation. The web-fetch skill SHALL teach
the agent to: detect an IP-block, tell the owner the single command to run on their machine (surfaced in
the conversation AND the cockpit, with the pairing code pre-filled and no install required), rely on the
pre-wired proxy rather than asking the owner to set an env var, verify egress before reporting success,
and request `pb relay login <site>` ONLY for a site that needs the owner's sign-in, naming that site and
why. A user SHALL be able to succeed having read zero docs.

#### Scenario: Blocked fetch, no relay running

- **WHEN** the agent's fetch or an app's crawl is refused at the network edge and no relay is running
- **THEN** the agent SHALL explain the block plainly and give the owner the exact one-command start
  (with code), rather than failing silently or telling the owner to read a manual

#### Scenario: A login-walled site

- **WHEN** a target needs the owner's signed-in session (not merely a non-datacenter IP)
- **THEN** the agent SHALL ask specifically for `pb relay login <that site>`, and only then, explaining
  that the site needs the owner's own login
