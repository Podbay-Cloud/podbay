# web-fetch Specification

## Purpose
Defines how a pod fetches and researches public web content WITHOUT evading anyone. A pod egresses from a datacenter IP that some sites refuse at the edge, and the universal runtime rules forbid the pod from misrepresenting itself to get past a block — so this capability defines the legitimate alternative: a ladder of methods (the source own API, direct fetch, published archives, third-party reader services that fetch from their own infrastructure, and the owner own browser session), the guardrails that keep it assisted rather than harvesting, and honest reporting when a target is fortified.
## Requirements
### Requirement: The relay's platform-side guards

The relay is open to the public web once the owner runs it (see "operated by the owner"), but the
platform side still enforces guards that do not depend on trusting the pod.

The domain a relay fetch is measured against SHALL be derived from the request URL by the platform, not
taken from a field the pod supplies. Otherwise a pod could name a benign domain while pointing the URL
at an arbitrary address — a server-side request forgery through the owner's own machine. Literal IP
addresses and non-web URLs SHALL be refused at the platform as well as at the relay.

Requests SHALL be rate-limited per domain, and the limit SHALL recover, so a burst does not lock a
domain out permanently while a runaway job still cannot hammer a site through the owner's connection.

A request the platform cannot serve SHALL NOT be attempted from the pod instead. That fallback is the
evasion the ladder exists to avoid, and it must be impossible rather than merely discouraged.

A relay result SHALL be delivered only to the pod that made the request, and SHALL be accepted only from
the owner whose relay was given it. Request identifiers SHALL be assigned by the platform, not trusted
from the pod, so one pod cannot replay another's identifier to capture its result — which, for a
logged-in fetch, would be the owner's private content.

A request the relay socket did not actually accept SHALL NOT be counted against the rate budget nor
reported as sent.

The relay SHALL be open to the public web for the owner's pods once it is running: there is no
per-domain or per-pod allowlist to maintain, because a research agent that needed the owner to
pre-authorise every site by hand would be unusable. What a fetch MAY use the owner's signed-in session
for is the one thing scoped per site (see "operated by the owner"); reaching a public page is not.

The rate budget SHALL be shared per owner and domain, since the source sees one address however many
pods the owner runs. Exceeding it SHALL DELAY a request rather than refuse it: the budget exists to
protect the source and the owner's address, and delaying protects both exactly as well as refusing
while still performing the work that was asked for. A delayed request SHALL report how long it expects
to wait, and SHALL be sent automatically when its slot frees, without the caller retrying. Where the
delay is caused by another of the owner's pods, that SHALL be said, naming it — an unexplained wait
reads as a stall.

Budgets SHALL be per domain, so a busy domain does not hold up an idle one.

Requests SHALL be refused only when they genuinely cannot be served: a domain that is not lent, or a
queue that is full.

Queued requests SHALL be dispatched fairly across pods rather than strictly first-in-first-out, and a
single pod SHALL NOT be able to occupy the whole queue, so one busy pod cannot starve another.

A pairing code SHALL be single-use and SHALL be consumed even when it has already expired, so a leaked
code cannot be retried. A pairing code SHALL be minted where the owner is authenticated and redeemed
where the relay connects; since these are not the same process, the code SHALL live in shared storage
and its single-use SHALL be enforced there, so two relays racing one leaked code cannot both connect. A
second relay for one owner SHALL replace the first rather than run alongside it. A result for a request
that was never made SHALL be discarded.

Because the single-use code cannot authenticate a RECONNECT, pairing SHALL also issue a durable,
reusable reconnect token bound to the owner; the relay SHALL store it and reconnect with it, and the
platform SHALL validate it without consuming it. So a gateway restart or a network blip SHALL NOT force
re-pairing. The token SHALL expire on its own and SHALL be revocable (a relay reset forgets it).

#### Scenario: The relay survives a gateway restart without re-pairing

- **WHEN** the connection drops (a gateway restart or a network blip) after the relay has paired
- **THEN** the relay SHALL reconnect using its stored reconnect token, WITHOUT the owner obtaining a new
  pairing code

Whether an owner's relay is connected SHALL be readable outside the process that holds the socket, so
the admin view and a pod both see the same answer; a connection whose keep-alive has lapsed SHALL read
as disconnected rather than be trusted.

#### Scenario: The owner's machine is asleep

- **WHEN** no relay is connected
- **THEN** the request SHALL queue with a reported position, and SHALL NOT be attempted from the pod

#### Scenario: A pod joins after the relay is already running

- **WHEN** a pod's control link opens while its owner's relay is ALREADY connected
- **THEN** that pod SHALL be told the current relay state on connect, rather than waiting for the next
  change — a pod that learns relay state only from broadcasts believes there is no relay, and tells the
  owner to pair one they are already running

#### Scenario: A pod cannot reach a source and no relay is connected

- **WHEN** a fetch is refused by the network (blocked, challenged, or login-walled) and the owner has no
  relay connected
- **THEN** the pod SHALL be given a ready-to-run command the owner can run on their own machine to bring
  a relay up, rather than only a dead end
- **AND** the command SHALL carry a freshly minted pairing code, so the owner does not have to obtain one
  separately

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
dashboard. Pod attribution on an owner-bound relay frame MAY include the pod's owner-chosen display
name (resolved by the gateway, never supplied by the pod); the field is optional and additive, so a
relay or gateway that omits it continues to function and the owner's dashboard falls back to the id.

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

#### Scenario: A burst over the concurrency bound waits for a slot

- **GIVEN** a pod already holds the maximum concurrent tunnel connections (its per-pod bound, or the owner's relay-wide bound)
- **WHEN** it opens another connection in the same burst
- **THEN** that connection SHALL be held briefly for a slot rather than refused, and admitted as soon as any open connection closes — including a slot freed by a sibling pod
- **AND** only if no slot frees within the hold window SHALL it be refused, and then as a capacity refusal the client can classify and retry — so a momentary spike rides out instead of losing connections, while a pod that sustains the overload past the bounded queue is still refused

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

### Requirement: The direct rung renders when a plain fetch returns a shell

Direct fetching SHALL have two modes at the same origin and identity: a plain request, and the same
request rendered by a real browser engine. The rendered mode SHALL be used when the plain one returns a
shell, which is exactly the signal the verifier reports as `empty`.

Rendering is not an escalation. It changes neither where the fetch originates nor what is read — only
whether JavaScript runs — so it belongs to the direct rung rather than displacing the rungs that DO
change those things.

The browser SHALL run as itself: no user-agent override, no stealth tooling, no fingerprint or
automation-flag manipulation. Beyond being outside what this platform does, it does not work for the
case it is reached for — a real browser with an honest identity receives the same refusal as a plain
request from the same address, because an edge refusal happens before any fingerprint is read. A source
that refused the plain mode SHALL therefore be escalated, never retried with an altered identity.

#### Scenario: A client-rendered page

- **WHEN** a plain request returns a shell and the page renders its content client-side
- **THEN** the rendered mode SHALL return the content

#### Scenario: A server-rendered page

- **WHEN** a plain request already returns the content
- **THEN** the rendered mode SHALL NOT be required

#### Scenario: A source that refuses this network

- **WHEN** the plain mode is refused by the source's network
- **THEN** the rendered mode SHALL NOT be presented as a way around it

### Requirement: The platform remembers which rung works for which domain

The platform SHALL keep a shared record of fetch outcomes per domain and rung, so an outcome is learned
once for the fleet rather than rediscovered per task and per pod.

Negative outcomes carry most of the value: knowing a domain refuses this network saves an entire ladder
every time it is asked for. A recorded refusal SHALL also carry WHY, so an agent can explain the gap
rather than silently skipping.

A verdict SHALL expire and be re-verified rather than trusted indefinitely, and an operator SHALL be able
to force a re-check. Forcing one SHALL NOT discard what was learned — "check again" is not "forget".

The rung and outcome recorded SHALL be validated against the known set before they are stored, because
they arrive from a pod over the network and the rung is part of the primary key of a fleet-wide table:
an unvalidated value could steer every tenant's fetches or flood the table. The record SHALL hold the
domain, the rung and the outcome only. Reducing input to a bare host SHALL be
enforced by the store itself rather than left to callers: callers naturally hold full URLs, a URL can
carry a credential, and a shared table containing URLs would be a fleet-wide log of what every owner
reads. No pod or owner attribution SHALL be stored.

#### Scenario: A domain already known to refuse this network

- **WHEN** an agent is asked to read a domain recorded as refused
- **THEN** it SHALL be told which rung works and which to skip, with the reason

#### Scenario: A stale verdict

- **WHEN** a recorded verdict is older than its expiry
- **THEN** it SHALL be treated as unknown rather than acted on

Outcomes SHALL travel on the reconcile pass that already runs, in both directions: a pod buffers what
it learned and the platform drains it, then pushes back the fleet's current plan. Pods SHALL NOT need
their own credential for this — the platform already polls them for every other pod-originated fact,
and following that direction means there is nothing to mint, rotate or leak.

A drain SHALL clear a pod's buffer only after its contents are safely read; sending an outcome twice is
better than losing a pod's history to a half-completed drain. A pod's buffer SHALL be bounded, so a pod
that is never drained cannot grow without limit. Expired verdicts SHALL NOT be pushed, and a single
malformed report SHALL NOT discard the rest of a drain.

The platform SHALL remain fully functional with no shared memory available: pods then climb the ladder
independently, which is slower rather than broken.

The relay rung SHALL NEVER be skipped on the strength of a remembered negative outcome. Every other
rung's ability to serve a domain is a property of the network and stays true across pods; the relay's
is DYNAMIC — it depends on the owner's live connection and which domains they have signed into right
now, neither of which the shared record can know. A single transient relay failure (a slow or hung
owner-side browser) recording `blocked` and then silently skipping the relay is exactly how a domain
the owner had just logged into stayed unreachable. So the relay SHALL be retried whenever it is
available, and a relay timeout SHALL be bounded so that retry stays cheap.

#### Scenario: A relay rung remembered as failing

- **WHEN** an agent reads a domain whose relay rung is recorded as a past failure
- **THEN** the relay SHALL still be attempted, because its availability depends on live owner state

#### Scenario: A pod that cannot be reached

- **WHEN** the platform cannot reach a pod on its poll
- **THEN** the pod SHALL keep its buffered outcomes and its previous plan

#### Scenario: A caller passes a full URL

- **WHEN** an outcome is recorded against a URL containing a path or query
- **THEN** only the host SHALL be stored

### Requirement: A rung's result is verified before it is believed

Every rung SHALL validate its result before returning it, and a result that fails validation SHALL
advance the ladder rather than be reported as content.

Transport success is not content success. Measured from a pod: a reader service returned HTTP 200
carrying the target site's "you've been blocked by network security" page. An unverified ladder reports
that as the answer — confidently, and wrongly, which is worse than reporting nothing.

Validation SHALL check, in increasing cost: transport status and redirect destination; known soft-block
signatures served with a success status; content plausibility against a text floor; and last, relevance
to what was requested. Relevance SHALL warn rather than reject, because it is the only check that can
discard a correct fetch.

A page's `<noscript>` fallback SHALL be excluded from signature matching. It is written for a browser we
are not, so matching it treats a page's fallback as its content — a rendered page carrying a leftover
"enable JavaScript" notice is not an empty page. A page that genuinely has nothing without JavaScript is
still caught by the text floor, which is the honest mechanism for it.

Signatures SHALL otherwise be matched against the RAW response, not extracted text. The clearest marker a
bot-management interstitial gives — its challenge script — lives in markup that text extraction
discards.

A refusal SHALL be distinguished from a challenge and from an empty shell, because the three imply
different next moves: a different network origin, a browser, and the browser rung respectively.

A rung that does not answer in time SHALL be recorded as a `timeout`, distinct from a refusal. A timeout
is TRANSIENT — a slow or hung transport, not the source saying no — so it SHALL be presented as such
(worth retrying) rather than collapsed into `blocked`, and it SHALL NOT be the basis for skipping a rung
whose availability is live (the relay above).

A refusal signature SHALL be treated as a refusal only when the response is NOT also carrying
substantial content. Sites serve real pages that contain a bot-management vendor's script, or a "log in
to continue" control in a header; a signature alone would discard those. Where content is present the
signature SHALL be reported as a warning instead — noted, not obeyed.

#### Scenario: A block page served as a success

- **WHEN** a rung returns HTTP 200 whose body is a block, challenge, or login page
- **THEN** the result SHALL be rejected and the next rung attempted

#### Scenario: A client-rendered shell

- **WHEN** a page returns less visible text than the plausibility floor
- **THEN** the result SHALL be rejected as needing a browser, rather than summarised as the page

#### Scenario: A good page

- **WHEN** a rung returns real content
- **THEN** validation SHALL accept it, and a keyword the caller expected but did not find SHALL warn
  rather than discard it

### Requirement: Declaring the capability is what makes it real

`capabilities.webFetch` SHALL determine whether the skill reaches the pod, and — when egress is
enforced — whether the ladder's fixed hosts are allowed through.

Before this, the flag governed neither: the skill shipped to every pod inside the shared layer while
the registry advertised it as gated and off by default, and the allowlist never consulted it. A flag
that gates only the description of a capability makes the specification untrue, which is worse than
having no flag, because a reader cannot tell which envs can reach the web.

Only rungs with FIXED hosts can be allowed through — the reader service and the archive. The API and
direct rungs fetch whatever the research target is, so no allowlist can cover them, and under a
restricted policy they are blocked by design. This SHALL be stated rather than discovered: an agent
hitting a proxy block reads it as a broken network, not as a policy someone chose.

#### Scenario: A restricted env that declares the capability

- **WHEN** an env enforces egress and declares web-fetch
- **THEN** the reader and archive hosts SHALL be in the effective allowlist

#### Scenario: An env that does not declare it

- **WHEN** an env does not declare web-fetch
- **THEN** the skill SHALL NOT be placed on the pod, and no ladder hosts SHALL be added

#### Scenario: Rungs restricted to arbitrary-target fetching

- **WHEN** an env restricts the ladder to the API and direct rungs
- **THEN** no additional hosts SHALL be claimed as allowed

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

### Requirement: The relay offers a transparent egress tunnel for the pod's own clients

> SYNCED from `openspec/changes/relay-egress-tunnel` on 2026-08-04 with the transport.

The relay SHALL offer, alongside dispatch-fetch, a transparent egress tunnel: a SOCKS5 proxy the pod's
own programs point at, so their traffic egresses from the owner's network with the live DOM intact — no
content snapshot, no recipe rewrite. The tunnel SHALL be selective: only clients that use the proxy
egress through the owner; all other pod traffic (the agent's own control-plane calls) SHALL continue to
leave from the pod's own address.

The tunnel SHALL carry the same platform-side guards as dispatch. The target SHALL be derived by the
platform from the connection request, never trusted from the pod; a private, loopback or link-local
target SHALL be refused at the pod, at the platform, AND — after DNS resolution, which only that end can
see — at the owner's relay; concurrency SHALL be bounded per pod and per owner; new connections SHALL be
rate-capped per domain; and a refused connection SHALL NOT count against the rate budget.

#### Scenario: An app egresses through the owner's IP with live DOM

- **WHEN** a program in the pod connects through the relay tunnel to a public site that blocks the
  datacenter IP
- **THEN** the connection SHALL egress from the owner's network and the program SHALL receive the live
  response, exactly as if it had been fetched from the owner's machine

#### Scenario: A hostname that resolves into the owner's private network

- **WHEN** a target's name is public but resolves to a private or loopback address
- **THEN** the connection SHALL be dropped at the owner's relay before any data flows

### Requirement: The pod exposes a pre-wired, fail-closed relay proxy

> SYNCED from `openspec/changes/relay-egress-tunnel` on 2026-08-04 with the transport.

The pod SHALL export a proxy endpoint (`PODBAY_RELAY_PROXY`) pre-set to a pod-local address, so an app
uses the relay with zero configuration. It SHALL fail closed: when no relay is running the endpoint
SHALL refuse connections with a clean error rather than hanging or falling back to the pod's own egress.
It SHALL NOT be exported as the global `HTTP(S)_PROXY`, so the agent's own control-plane traffic is
never routed through the owner's network.

#### Scenario: Proxy is inert until the relay starts

- **WHEN** an app uses `PODBAY_RELAY_PROXY` and no relay is running
- **THEN** the connection SHALL be refused cleanly, and SHALL begin succeeding once the owner starts a
  relay — with no change on the pod

#### Scenario: The relay's concurrency limits are legible, not just enforced

- **WHEN** the tunnel enforces its per-pod / per-owner concurrency caps and per-domain rate cap
- **THEN** those limits SHALL come from a single shared source (so the enforcing gateway and the
  reporting pod agree: 32 streams per pod, 64 per owner, 120 requests per domain per minute); the pod
  SHALL expose its LIVE usage (`N of M streams in use`, surfaced by `podbay relay check`); and a
  refusal SHALL carry a CLASSIFIED reason so a fail-closed workload can tell a soft, retryable limit
  (capacity / rate) from a hard "no relay is running" — rather than mistaking a saturated cap for an outage
