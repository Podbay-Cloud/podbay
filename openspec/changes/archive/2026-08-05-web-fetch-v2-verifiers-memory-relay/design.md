# Design

## The verifier is the load-bearing piece

Everything else here is plumbing around one fact: **transport success is not content success.** A
verifier turns a rung from "did it respond" into "did it answer", and it is the only part that makes
the rest trustworthy — shared memory built on unverified outcomes would confidently record that a
block page is a working rung.

A verifier is a pure function over `(request, response)` returning `ok` or a reason. Four checks,
cheapest first:

1. **Transport** — status, redirect chain landing on a login page.
2. **Soft-block signatures** — the fingerprints of a refusal served as a 200. Observed live: the reader
   service emits a machine-readable `Warning: Target URL returned error NNN` line; "You've been blocked
   by network security"; "Just a moment…" (bot-management challenge); "Enable JavaScript"; a body under
   a length floor.
3. **Plausibility** — length floor, expected structure present (a page that renders to 200 characters
   is a shell, not an article).
4. **Relevance** — does the content contain what was asked for. Weakest signal, and deliberately last:
   it is the one that can reject a *correct* fetch, so it warns rather than fails.

Pure and fixture-driven on purpose. Recorded block pages, challenge pages, login walls and empty
shells make the highest-value tests in this change runnable in CI with no network.

## Rungs after this change

| # | rung | fixes | notes |
|---|---|---|---|
| 0 | official API | everything, where one exists keyless | HN/Algolia verified 200 keyless; Reddit's is gated behind review |
| 1a | direct fetch, plain | server-rendered HTML | instant; most of the web |
| 1b | **direct fetch, rendered** (new) | client-rendered pages | tldraw 14→222 chars, excalidraw 79→349. Honest identity, no stealth |
| 2 | archive | dead/blocked pages, sometimes | itself DC-throttled (429 observed) |
| 3 | reader service | occasionally | **demoted**: capped, and returns block pages as 200s |
| 4 | **relay** (new) | IP-blocked sources | the only rung that changes network origin |

**Why the browser is a MODE of rung 1 rather than a rung of its own.** The ladder escalates on two axes:
where the fetch originates, and what we read. Rendering changes neither — same IP, same identity, same
terms posture; only the JS engine differs. Making it 1b keeps the ladder's numbering meaningful (and
matches the original brainstorm, which had "direct fetch + headless render" as one rung before the skill
dropped the render half). An earlier draft of this design listed it as rung 2 and renumbered everything
below it, which was churn in exchange for a worse model.

## What was measured, so nobody re-litigates it from memory

Three experiments, 2026-07-30, all from this pod:

| experiment | result |
|---|---|
| realistic UA + viewport + locale + timezone, vs default headless | **no change**: g2.com 403 challenge both ways; crunchbase.com 200 with ~23,160 chars both ways (a 9-char difference is noise) |
| persistent profile, three sequential visits to a challenge-class site | **no change**: 403 every time; cookies accumulated (3) and the outcome did not move |
| real Chromium, honest UA, vs curl, against an IP-refusing site | **byte-identical 403** |

What that does and does not establish:

- For an **edge/IP refusal**, client realism is irrelevant — the refusal precedes it.
- For the **challenge class**, the specific levers proposed (UA, viewport, locale, timezone, cookie
  persistence) moved nothing on the two sites testable from here.
- A clearance cookie plausibly still helps — but only if a HUMAN passes the challenge once in that
  profile, which cannot happen on a pod and is exactly what the relay's headed login provides. So the
  cookie idea is not dead; it just lives on the owner's machine, not here.
- Two sites is not the web. This is evidence against the pod-side investment, not proof.

## Why fingerprint spoofing is not on that list

A real headless Chromium with its honest user-agent received the byte-identical 403 that curl did. The
refusal is at the network edge; no amount of canvas noise, UA rewriting or CDP hiding is reached. So
stealth would spend real effort on a layer that never executes for the motivating case — and it is
detection evasion, which this platform does not do. A real browser is here for **rendering**, and it
tells the truth about what it is.

Worth recording how that evidence was corrected: the first draft cited react.dev, which turned out to
be server-rendered — a plain fetch already returns 8,352 characters of text, so it argued for nothing.
The real examples are client-rendered app shells (tldraw 14→222, excalidraw 79→349). The mechanism is
solid; the magnitude is smaller than the wrong example implied, and the rung is justified by the ratio
rather than the byte count.

## The transport, settled

Three subsystems need to move data between a pod, the control plane and the owner's machine: fetch
memory, relay requests, and relay state. They were designed separately and drifted into three answers.
One mechanism now serves all three.

### The problem that forced the decision

There is no periodic reconcile. `reconcile()` runs for pods in a TRANSIENT state, on a `getPod` for
those same states, on the admin drill-in page load, and inside the idle sweep for `waking` pods — a
healthy running pod can go days without one. "It rides the poll that already runs" was wrong: for a
steady-state pod that poll barely runs. Fetch memory would fill at the speed of dashboard visits, and a
relay request would wait an unbounded time.

### The mechanism: the gateway dials the pod and keeps the socket

The gateway opens a WebSocket TO each running pod-agent and holds it. Messages then flow both ways —
but the pod still never *initiates* a connection, so there is still nothing for it to authenticate to
and no pod credential to mint, rotate or leak. That property was the reason for the drain/push design
in the first place; this keeps it and drops the latency.

Over that socket:

| direction | payload |
|---|---|
| pod → gateway | fetch outcomes; relay fetch requests |
| gateway → pod | fleet fetch plan; relay results; relay state (connected / domains) |

**HTTP remains the floor, the socket is the accelerator.** `GET`/`POST /fetch-memory` stay exactly as
built, driven by a 60-second sweep. If the socket is down — restart, network blip, a pod on an older
image — everything still works, just at sweep speed. Nothing depends on the socket being up, which is
what makes it safe to add.

### Why not the alternatives

- *Pod dials the gateway*: needs a pod credential, and reverses the trust direction every other pod
  interaction uses.
- *Fast HTTP polling*: a poll storm proportional to fleet size, to carry traffic that is usually zero.
- *Keep the 60s sweep only*: fine for memory, unusable for a relay fetch an agent is waiting on.

## Relay request flow, end to end

1. The ladder reaches the `relay` rung on a pod.
2. The pod-agent sends the request over the control socket and **blocks up to 60s** — because when the
   owner's machine is awake this takes seconds, and returning a ticket the agent must poll for would be
   worse in the common case.
3. The gateway checks policy (scope, rate), then dispatches to the owner's relay.
4. No relay connected → the request QUEUES and the pod is told `pending` immediately rather than
   blocking pointlessly. The agent reports "1 source awaiting relay" and moves on.
5. The relay fetches in its browser profile and returns the result; the gateway routes it back by
   request id, which carries the `podId`.

## Sharing one relay between several pods

One owner, one MacBook, two pods is the normal case, not an edge case. It settles four things:

- **One relay per owner, one browser profile per relay — not per pod.** Profiles hold the owner's
  signed-in sessions, and there is one human. Per-pod profiles would mean signing into the same site
  once per pod, which nobody would do.
- **Authorisation is per pod, though.** An allowlist entry carries which pods may use it, so lending
  `reddit.com` to an ops bot does not hand a client project's agent your Reddit session. This is the
  part the two-pod scenario exposed: without it, the relay is an owner-level capability and every pod
  you own inherits every session you lend. The CLI requires an explicit scope (`--pods` or `--all`)
  rather than defaulting to all, because "all" is the default nobody would choose deliberately.
- **The rate cap stays per owner+domain**, because the site sees one address and one identity however
  many pods you run. But a refusal caused by ANOTHER pod says so — "rate limit" with no explanation
  reads as a bug when your other pod quietly spent the budget.
- **Dispatch round-robins across pods** rather than strict FIFO, and each pod gets a bounded share of
  the queue, so one pod queueing fifty requests cannot starve another.

Concurrency is capped on the relay itself too: two pods asking at once must not open twenty tabs on
someone's laptop.

## Shared memory

Served live, not shipped in the image. The skill is instructions and changes monthly; the table is data
and changes daily. An image is ~20 minutes to build plus a per-pod update, which is the wrong pipe for
a routing table.

```
podbay fetch-plan <domain>    → { good: [rung], bad: [rung], lastVerified, ttl }
podbay fetch-report <domain> <rung> <ok|blocked|empty|challenged>
```

Stored per domain: outcome counts per rung, last verified, and a TTL after which a verdict is re-checked
rather than trusted forever. Pods cache the plan locally so a control-plane blip degrades to
stale-but-working.

**Privacy boundary — this is what makes "shared" acceptable.** Stored: registrable domain, rung,
outcome, counts, timestamp. Never stored: full URLs, page content, or which pod/owner asked. The table
is a capability map, not a research log. Without that boundary a shared table would be a fleet-wide
record of what every owner researches.

## Relay

**Transport: an outbound WebSocket from the owner's machine to the gateway.** No inbound port, no NAT
traversal, no ngrok, no WireGuard on the owner's machine, and it survives a corporate firewall. This
supersedes the long-poll in the earlier sketch — long-polling is a worse implementation of the same
thing, and the gateway already speaks WebSocket to pods.

**Auth: the existing pairing-code flow** (built for Codex remote control, `service.ts:1073`) — short
lived, one-time, bound to the owner. No new auth model.

**The relay drives a BROWSER — it is not a network proxy.** Worth stating plainly because the design
reads either way otherwise. A proxy would forward bytes from the owner's IP: no JavaScript, no signed-in
session, and it is precisely the "rent my residential IP" shape this design refuses. Instead the relay
navigates a real browser on the owner's machine and returns what that browser rendered. That is why the
fingerprint question mostly dissolves in the relay: the browser is not imitating a real one, it IS one.

**Runtime: Node, cross-platform** — macOS, Windows, Linux, x64 and arm64. Locating Chrome is not ours to
hand-roll: Playwright's `channel: "chrome"` already knows the per-OS install locations and fails cleanly
when absent. It SHOULD drive the owner's already-installed Chrome rather than downloading its own engine: no 100-300 MB
first-run download, and it is genuinely their browser. Falls back to a downloaded Chromium when Chrome
is absent. Fetches run headless; `pb relay login` runs headed, which needs a desktop session — acceptable,
since a machine with no display is not the residential context the relay exists for.

**Credentials do not move machines — the RESULT comes back, the session stays.** Recording this because
it will be proposed again as an optimisation: once the relay holds a signed-in profile, why not export
those cookies to the pod's browser and skip the relay? Four reasons, in order of how quickly they bite:

1. *It largely does not work.* The relay exists because the pod's address is refused, and a cookie does
   not change an address. Cloudflare's clearance cookie is documented as bound to the IP and user agent
   that solved the challenge, and session-binding of that kind is common — worth testing before relying
   on it either way, but the default assumption should be that it fails.
2. *It endangers the owner's account.* A signed-in session appearing from a datacenter IP is the textbook
   account-takeover signal. The account that gets locked is theirs.
3. *It removes the property that makes the relay defensible.* "My browser fetched a page for me" and
   "a server in Germany is impersonating me" are different things, and the difference is exactly that the
   fetch happens on the owner's machine.
4. *It puts a live credential on a volume an agent controls* — the thing the diagnostics boundary and the
   replay masking both exist to prevent.

What DOES transfer is knowledge, not credentials: "this domain needs the relay" belongs in the shared
memory table, and the fetched content comes back to the pod because that is the point. The rule of thumb:
use the credential designed for the context. A browser cookie is designed for a browser on a person's
machine; an API token is designed for a server. Moving the first into the second is the mismatch.

**Browser: a profile the relay owns**, not the owner's daily browser. `pb relay login <domain>` opens
that profile *headed* so the owner signs in normally, including 2FA; later fetches run headless against
the same persisted profile. Driving their real Chrome would hand a pod every cookie they own for every
site; this scopes credentials to the domains they choose. An expired session is a verifier signature
(login wall), reported as "run `pb relay login X`" rather than returned as content.

**Availability is intermittent by nature.** The owner's machine sleeps, so a 6am job cannot depend on
it. Relay requests QUEUE with a visible pending state and the job degrades honestly ("3 sources read,
1 needs relay") rather than blocking or silently skipping. Requiring an always-on host was considered
and rejected: a VPS is not residential, which removes the reason the relay exists.

**Fail-closed.** No relay connected, or the domain not allowlisted → the rung reports unavailable. It
never falls back to re-hitting the site, which would be the evasion this whole design refuses.

**Rate caps on both sides** — the pod bounds what it asks for and the relay bounds what it serves, so a
buggy job cannot spam a site through the owner's connection.

**Disclosure at pair time.** Automating a logged-in session is against many sites' terms, and the
account at risk is the owner's, not Podbay's. That belongs in the enable-time copy, stated plainly.

## Where relay status belongs — and does not

Relay *connection state* is platform state: cockpit (this pod: connected / none) and admin (fleet). Relay
*logs* stay on the owner's machine, where the fetching happens; shipping them to Podbay would recreate
exactly the privacy leak the memory boundary avoids. A playbook's own dashboard shows the
*consequence* — "1 source needs relay" — not relay internals, because the relay is owner-level
infrastructure shared across pods, not a component of any one pod's app.

## Test plan

1. **Verifier fixtures, no network** — recorded block/challenge/login/empty pages. Cheapest, and where
   most of the correctness lives.
2. **Fake relay speaking the real protocol** — routing, timeout, kill switch, rate cap, fail-closed,
   queue-while-disconnected.
3. **Real relay running on a pod**, pointed at the gateway: a pod plays "the owner's machine", so
   end-to-end needs no laptop.
4. **One manual laptop gate** at the end — the only step that needs a human, and the only one that
   proves a real logged-in session works.

## Open questions

- ~~Memory TTL before a `blocked` verdict is re-checked~~ **DECIDED 2026-07-30: 7 days.** Short enough
  that a site loosening its edge rules is noticed within a week; long enough that the saving (skipping a
  whole ladder) still holds for the common case. Admin re-verify remains available for impatience.
- Whether the fetch-memory API needs its own per-pod token or can ride the pod-agent's existing trust.
- ~~npm vs tarball~~ **DECIDED 2026-07-30: one build, two ways to fetch it.** Publish to npm; the
  "tarball" is the SAME artifact (`npm pack`) documented as a fallback for anyone who cannot reach the
  public registry. Deliberately not two advertised paths of equal standing — the relay is a long-lived
  daemon speaking a protocol to our gateway, and two channels doubles the version-skew surface for a
  tool that holds live sessions.
- **Version pinning over `@latest`.** Guidance is a pinned version (`npm i -g @podbay/pb@x.y.z`), not
  `npx @latest`: re-downloading and executing remote code on every start is the wrong default for a
  daemon holding someone's signed-in sessions. The relay SHALL announce its version on connect and the
  gateway SHALL refuse an incompatible one with an actionable message, rather than failing obscurely
  mid-fetch.
