# Tasks

Ordered so the ops robot gets an HONEST fetcher first. Verifiers + memory are most of the value and
none of the policy risk; the relay is the biggest build and the only part that touches someone's
account, so it comes last — and the memory table tells us empirically which domains actually need it.

## 1. Verifiers (no network needed — do this first)

- [x] 1.1 Record fixtures from real refusals: reader-service `Warning: Target URL returned error NNN`,
      "You've been blocked by network security", a bot-management "Just a moment…" page, a login wall,
      an empty JS shell, and one GOOD page per rung as the negative control.
      — 6 REAL captures in `packages/shared/test/fixtures/fetch/` (reader-200-with-block-page, Cloudflare challenge from g2.com, direct 403, client-rendered shell, plus a good HTML page and a good API response as negative controls). One gap: no dedicated login-wall fixture — the Reddit block page carries the login phrasing, which is weaker.
- [x] 1.2 `packages/shared/src/fetch-verify.ts` — pure `verify(request, response) → ok | reason`, the
      four checks cheapest-first. Relevance warns, never rejects.
      — `packages/shared/src/fetch-verify.ts` — pure, four checks cheapest-first, signatures matched on the RAW body because `challenge-platform` lives in a script src that text extraction strips.
- [x] 1.3 Tests over the fixtures, asserting each signature is caught AND that good pages pass — a
      verifier that rejects everything is as useless as one that accepts everything.
      — `packages/shared/test/fetch-verify.test.ts` — 9 tests, including both negative controls and the subtly-wrong cases (raw-vs-extracted matching, redirect-to-login, relevance warning only, caller-supplied text floor).
- [x] 1.4 Teach the skill the signatures and the rule: never present unverified content as an answer.
      — SKILL.md now carries the signature table with the live 2026-07-30 measurements, the `Warning: Target URL returned error NNN` signal, and the two rules that follow (never report unverified content; a short body is suspicious, not empty).

## 2. Rendered mode for rung 1 (NOT a rung of its own — see design.md)

- [x] 2.1 Add rendered mode to rung 1 in the skill, prebaked Chromium, honest identity, with the
      "no stealth" prohibition AND why it would not work.
      — `SKILL.md` rung 1 now has 1a plain / 1b rendered. Reframed mid-implementation: rendering changes
        neither where the fetch originates nor what we read, so it is a MODE, not a rung. That also
        matches the original brainstorm ("direct fetch + headless render" as one rung) and avoided
        renumbering the whole ladder for a worse model.
- [x] 2.2 Verify live: a client-rendered page renders, and an IP-refused page still reports the refusal.
      — 2026-07-30 from this pod: tldraw.com 14 chars plain → 222 rendered; excalidraw.com 79 → 349;
        reddit.com refused identically (403, byte-identical body) plain AND rendered. Counter-example
        recorded in the skill so nobody reaches for the browser reflexively: react.dev is server-rendered
        and yields 8,352 chars to a plain fetch.
- [x] 2.3 Guard the boundary in a test: no UA override, no stealth flags, no `navigator.webdriver` patch.
      — `packages/shared/test/no-stealth.test.ts`: scans every fetching skill for stealth techniques
        (allowing mentions that sit beside a prohibition), and asserts the skill STATES the prohibition
        and the reason it would not work. Absence of the code is not enough when the reader is an agent
        deciding what to do next.

## 3. Shared fetch memory

- [x] 3.1 Schema + migration: per-domain per-rung outcome counts, last verified, expiry. Domain, rung,
      outcome ONLY — no URLs, no content, no pod/owner attribution.
      — `fetch_memory` table + migration `0027` — domain, rung, outcome, counts, lastVerified. Expiry is DERIVED from lastVerified, so changing the TTL is a config change rather than a migration.
- [x] 3.2 Control-plane read/write + aggregation; expiry makes a verdict re-checkable, not permanent.
      — Also the EXCHANGE: `exchangeFetchMemory` rides the reconcile poll (pod-agent
        `GET/POST /fetch-memory`, provider `drainFetchReports`/`pushFetchPlan`), 5 round-trip tests
        including a malformed report that must not lose the whole drain, and a service with no fetch
        memory configured at all — degraded, never broken.
      — `packages/control-plane/src/fetch-memory.ts` — record / plan / all / expire. `expire()` is the operator's re-check: it ages a verdict without deleting the counts, so "check again" does not mean "forget".
- [x] 3.3 In-pod CLI, GROUPED subcommands (a namespace once a noun has more than one verb):
      `podbay fetch plan <domain>` / `podbay fetch report <domain> <rung> <outcome>`, with a local cache
      + TTL so an unreachable control plane degrades to a stale plan.
      — `podbay fetch plan|report` in the in-pod CLI, 8 tests. The plan is a file the control
        plane PUSHES and reports buffer locally for it to drain, because the pod never calls out —
        see 3.4. Host reduction is enforced in bash too, so a URL with a token cannot reach the
        buffer. Buffer is bounded (newest kept) so an undrained pod cannot grow a file forever.
- [x] 3.3b `podbay fetch get <url>` — run the whole ladder in one command: climb, verify, consult and
      update memory, return content plus provenance. Today every agent hand-rolls curl → browser →
      verify differently, which makes the verifier ADVISORY; this makes it enforced and consistent
      across pods. The skill still documents the ladder, because an agent sometimes needs to deviate.
      — `podbay fetch get <url>` → pod-agent `POST /fetch` → `fetch-ladder.ts` (pure decisions,
        12 tests) + `fetch-runner.ts` (thin IO). Verified live end-to-end: react.dev resolves at
        direct in 56ms, excalidraw and tldraw escalate to the browser, reddit exhausts the ladder
        and returns advice pointing at the relay. Two real bugs found by RUNNING it — see the
        commit.
- [x] 3.3c `podbay relay status` — is a relay connected for this pod, so the agent knows to queue
      before it tries. `podbay secrets list` (names only, never values) — agents routinely need to know
      which keys exist.
      — `podbay relay status` distinguishes NOT CONFIGURED from configured-but-offline, because
        conflating them sends someone to the wrong fix. `podbay secrets list` prints names and
        set-ness only; 6 tests, one asserting a real-looking secret value never appears and one
        that `secrets get` is refused outright.
- [x] 3.4 Decide and implement the pod→control-plane auth for these calls (open question in design.md).
      — RESOLVED: no new credential. The pod never calls the control plane, and that is not a
        limitation to work around — it is how everything else already works (`ingestRepairs`:
        the control plane polls the pod and drains what it finds). Following the existing
        direction means nothing to mint, rotate, revoke or leak. The plan is pushed down, the
        reports are drained up, both on the poll that already runs.
- [x] 3.5 Skill: ask memory before climbing, report after landing.
      — SKILL.md now opens the ladder with `podbay fetch get <url>` and says WHY to prefer it — verification is enforced inside the command, where hand-rolling makes it only as good as your memory of the doc at that moment. Also documents `fetch plan` (inherit what the fleet knows), `fetch report` (when you climb by hand), and reading the `advice` field, since the outcomes point at different next moves.
- [x] 3.6 Admin surface: domain table with per-rung success/error rates, last verified, re-verify action.
      — `/admin/fetch-memory` — worst-behaved domains first (a table sorted by name buries the one worth looking at), every row carrying WHEN it was verified and a `stale` marker, plus a per-domain Re-check that ages verdicts without deleting the counts. The privacy boundary is stated on the page itself, not only in the design doc: this is the surface that would otherwise make someone assume it holds URLs.
- [x] 3.7 Test that a recorded refusal actually SKIPS rungs — the saving is the whole point.
      — `test/fetch-memory.test.ts` — 8 tests. The skip case asserts the plan carries WHY a rung is bad, not just that it is skipped, so an agent can explain itself.

## 3b. Control socket (decided 2026-07-30 — see design.md "The transport, settled")

- [x] 3b.1 Pod-agent: `/control` WebSocket endpoint. The GATEWAY connects to it, so the pod still never
      initiates and still needs no credential.
      — `packages/pod-agent/src/control-link.ts` + `/control` route in server.ts; 9 tests; verified live against a real pod-agent (plan/state written, outcomes pushed, pong).
- [x] 3b.2 Gateway: hold one control socket per running pod, reconnect with backoff, and carry fetch
      outcomes up / plan down over it.
      — `packages/gateway/src/pod-control-hub.ts`; 11 tests; wired into the gateway sweep, main.ts, and PodService.listRunningIds. Plan single-sourced via FetchMemory.fleetPlan.
- [x] 3b.3 Keep the HTTP `/fetch-memory` path as the FLOOR, driven by a 60s sweep. Nothing may depend on
      the socket being up — that is what makes it safe to add.
      — HTTP `/fetch-memory` kept as the floor; `exchangeFetchMemory` now runs from the gateway PodService too and shares FetchMemory.fleetPlan with the socket.
- [x] 3b.4 Test the degraded path explicitly: socket down, sweep still syncs; pod on an older image with
      no `/control` at all still participates over HTTP.
      — Degraded path covered: hub test 'drops a pod whose connect throws, retries next pass' (an old-image pod with no /control is exactly this), plus the 5 HTTP round-trip tests that need no socket. To be observed LIVE on deploy — current fleet is on older images without /control.

## 4. Relay — protocol + gateway

- [x] 4.1 Gateway relay socket: owner's machine connects OUTBOUND, no inbound port, no tunnel, no
      third-party. Supersedes the long-poll sketch in `docs/plans/web-data-acquisition.md:68-77`.
      — `/relay` WebSocket on the gateway — the owner's machine connects OUTBOUND. No inbound port, no tunnel, no third party. 7 tests against a real socket.
- [x] 4.2 Pairing via the existing Codex-RC code flow — short-lived, one-time, owner-bound.
      — Pairing by one-time code in the connect URL (not a session cookie — the relay is a CLI, not a browser), redeemed through the registry that already spends expired codes.
- [x] 4.3 Dispatch + queue: requests queue while disconnected, with a visible pending state.
      — Queue is bounded and flushed in arrival order on connect; `state()` reports connected/queued/
        domains so an agent can act BEFORE it tries. Socket wiring still to come (4.1).
      — Queue + flush-on-connect proven over the real socket: a request queued while nobody was
        connected is delivered the moment the relay pairs.
- [x] 4.4 Per-domain allowlist and rate caps enforced on BOTH sides.
      — `packages/gateway/src/relay-registry.ts` — per-owner allowlist (empty means NOTHING, the right default for something borrowing a person's identity), parent-domain coverage without matching lookalike suffixes, and a per-domain rate cap that recovers rather than locking a domain out. 14 tests.
- [x] 4.5 Fail-closed: unavailable relay or non-allowlisted domain never falls back to the pod.
      — Fail-closed proven, not asserted: a refused domain dispatches nothing and never redirects to the pod — the test checks the link received zero sends.

## 5. Relay — the owner's CLI

- [x] 5.1 New `packages/pb`, published as `@podbay/pb` (scope verified unclaimed 2026-07-30), with
      `pb relay` as the ONLY implemented subcommand so it slots into `docs/plans/entry-points-plan.md`
      instead of becoming a second owner-side binary. Not a full CLI in this change.
      — `packages/pb` published as `@podbay/pb`, `pb relay` the only subcommand. Playwright a peer dep, lazily imported so the protocol/allowlist code tests without a browser.
- [x] 5.2 `pb relay` — pair, connect, serve, status, stop. Concurrency capped, so two pods asking at
      once cannot open twenty tabs on someone's laptop.
      — `pb relay serve|status|reset`; concurrency capped in RelayClient (a fourth request is refused, not a fourth tab). 18 tests.
- [x] 5.2b `pb relay allow <domain> --pods a,b | --all` — an explicit scope is REQUIRED. Defaulting to
      all is the default nobody would choose deliberately.
      — `pb relay allow <domain> --pods a,b | --all` — the scope is REQUIRED; omitting it dies. Verified.
- [x] 5.3 `pb relay login <domain>` — open the relay's OWN persistent profile headed so the owner signs
      in (2FA included); later fetches run headless against it. Never the owner's everyday profile.
      — `pb relay login <domain>` opens the relay's OWN persistent profile headed; fetches run headless against it.
- [x] 5.3b First-run consent screen, before any browser launches: name the Chrome binary found (or that
      Chromium will be downloaded), state that a SEPARATE profile directory is used and the everyday
      profile is untouched, list the allowlisted domains, and carry the terms-of-service disclosure.
      Launching someone's browser is the moment to ask, not to assume.
      — First `serve` prints the disclosure and refuses without `--accept`; consent recorded.
- [x] 5.3c Explicit NON-goal, guarded by a test: the relay never exports its cookies or storage state to
      a pod. See design.md — credentials do not move machines.
      — `no-cookie-export.test.ts` — a source-level guard that the relay never uses storageState/cookie export and the result carries body/status/finalUrl only. Credentials do not move machines.
- [x] 5.4 `pb relay reset` — wipe the profile. Restrictive permissions on the profile directory, and say
      in the docs that it holds live sessions.
      — `pb relay reset` wipes the profile (sessions), keeps grants; config written 0600.
- [x] 5.5 Enable-time disclosure: automating a signed-in session may breach a site's terms, and the
      account at risk is the owner's.
      — Disclosure states the two facts that matter: the relay acts AS the owner, and the banned account is theirs.

## 6. Surfaces

- [x] 6.1 Cockpit: relay connected / none for this pod (settings-tab row, owner's relay status;
      "Connected · domains" or a `podbay relay start` hint). DEPLOYED 2026-08-02.
- [x] 6.2 Admin: relay state across the fleet — `/admin/relay` dashboard: summary strip + connected
      relays (owner NAME/email, their pods) + traffic by domain + **by pod** (live) + policy plan.
      Live queue/req-rate via a gateway `/admin/relay-state` endpoint (bearer ADMIN_API_TOKEN).
      DEPLOYED 2026-08-02.
- [x] 6.3 Deliberately NOT built: shipping the owner's relay logs to Podbay. They stay on their machine.
      REINFORCED 2026-08-02: we considered persisting **per-pod history** for the dashboard and chose
      NOT to — Podbay's persisted record stays domain-only, never who-asked-what; per-pod attribution
      lives only in the ephemeral live view.

## 7. Verification

- [x] 7.1 Fake relay speaking the real protocol — COVERED by the gateway relay test suite (63 tests):
      routing, awaiter timeout/expiry, rate-cap/pacing, queue-while-disconnected, bounded queue, SSRF
      gate, result-hijack, reconnect, budget accounting, fail-closed refusals.
- [x] 7.2 Real relay end-to-end — PROVEN 2026-08-01: a pod fetch of reddit routed pod→gateway→owner's
      real browser→back (168KB/6s). (Was a Mac, not a pod-as-relay, but proves the loop.)
- [~] 7.3 Manual laptop gate (the one human step) — proven once 2026-08-01; owner re-confirms on the
      fixed `pb@0.1.3` (Cmd+Q the stuck login Chrome, `pb relay login reddit.com`, fetch r/programming
      as them). Pending owner (scheduled).
- [ ] 7.4 Re-run the 2026-07-30 probe set into the memory table as the baseline — do alongside 7.3.

## 8. Docs

- [x] 8.1 `docs/plans/web-fetch-capability.md` — SHIPPED-state summary added at the top; brainstorm kept
      as the reasoning record.
- [x] 8.2 `docs/runbooks/playbook-authoring.md` — research-env checklist line for `podbay fetch get` +
      the relay.
- [x] 8.3 Owner-facing relay runbook — `docs/runbooks/relay.md` (what it is, what it sees, guardrails,
      how to stop it, what it risks).

## Wiring (completes the loop — done 2026-07-31)

- [x] W.1 Pod relay rung: `runFetch` gains a `relay` fetcher when the control socket is up; the
      pod-agent `submitRelayFetch` mints an id, registers a waiter WITH A TIMEOUT (fixing the leak
      the audit flagged), and sends over the control socket.
- [x] W.2 Gateway `routeRelayFetch`: resolves the pod's owner, mints a gateway id, submits to the
      relay, and routes the result DOWN to the pod under the pod's OWN id. `main.ts` instantiates the
      RelayRegistry. The hub now exists if fetch-memory OR relays is configured — relay routing must
      not depend on fetch-memory.
- [x] W.3 The gateway registry dropped its per-owner allowlist to match the CLI's clean-by-default
      model — authorisation lives on the owner's machine; the gateway keeps only the SSRF host guard
      and the per-domain rate cap. (An integration test caught the two disagreeing.)
- [x] W.4 End-to-end test: a fake pod + fake relay around a real gateway prove pod → gateway → relay →
      back, result addressed with the POD's own id. Caught a control-link listener race (a frame sent
      right after control-hello was dropped) — fixed by buffering from before the handshake.
- [x] 6.1 `pb relay dashboard` — a local web page of what the relay fetched (replaces the text stats).
