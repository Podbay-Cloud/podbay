## Why

Web-fetch v1 shipped a ladder of rungs and a rule against evasion. Live probing on 2026-07-30 showed
the ladder's middle is much weaker than the design assumed, and that the failures are **silent**:

| probe (from a pod, datacenter IP) | result |
|---|---|
| `r.jina.ai` → reddit.com | **HTTP 200** carrying Reddit's "you've been blocked" page |
| `old.reddit.com/….json` (no key) | 403 |
| Wayback availability API | 429 — the archive rung is itself throttled from a DC |
| **real Chromium, honest UA, no stealth** → reddit.com | **403**, byte-identical block page |
| same browser → tldraw.com | 200 — but a plain fetch of it yields **14 characters** of text |

Three conclusions, each of which invalidates part of v1:

1. **A 200 does not mean the fetch worked.** The reader service returns block pages, challenge pages,
   login walls and empty shells with a success status. Nothing in v1 checks, so the agent reports a
   block page as if it were content — the worst possible failure, because it is confident and wrong.
2. **Reader services are a candidate, not a tier.** They are rate-capped and frequently refused. v1
   leans on rung 3 as the general answer; it is not one.
3. **For an IP-blocked source, nothing in rungs 0–3 changes the outcome.** A real browser with an
   honest identity got the *same* 403 as curl, because the refusal happens at the network edge before
   anything can be fingerprinted. Only a different network origin changes it. The sanctioned
   alternative that block page suggests — Reddit's developer token — is gated behind an application and
   review with an uncertain outcome, so "the owner supplies an API key" is not a real path for most
   owners.

v1 also has a gap it never named: **the agent re-derives everything on every task.** It has no way to
know that a domain was IP-blocked yesterday, so it burns four rungs and several minutes rediscovering
it, every time, in every pod.

## What Changes

- **A verifier per rung.** A rung's result is accepted only if it passes a contract: transport status,
  soft-block signatures, content plausibility, and relevance to what was asked. A rejected result
  advances the ladder instead of being reported as an answer.
- **A real-browser rung** (Chromium, already prebaked on every pod, being itself). It fixes
  CLIENT-RENDERED pages: a plain fetch of tldraw.com returns 14 characters of text where a browser
  returns 222, and excalidraw.com 79 vs 349. (An earlier draft of this proposal cited react.dev as the
  example — wrong: react.dev is server-rendered and a plain fetch already gets 8,352 characters. The
  corrected examples are smaller in absolute terms because they are app shells, so the honest claim is
  about the ratio, not the volume.) It explicitly does NOT attempt
  stealth, UA spoofing or fingerprint manipulation — proven useless for the case that motivates it,
  and outside what this platform does.
- **Shared fetch memory.** A fleet-level `domain → rung → outcome` table, served live by the control
  plane, read and written by pods, surfaced and re-verifiable in admin. Negative results carry most of
  the value: "this domain is IP-blocked" saves the whole ladder.
- **The relay** (`pb relay`): the owner's machine, an outbound WebSocket to the gateway, a browser
  profile the relay owns and the owner logs into once. Scoped, opt-in, rate-capped, fail-closed, and
  disclosed — the account at risk belongs to the owner.
- **Reader services demoted** from default to one candidate the verifier judges like any other.

## Impact

- `environments/_shared/universal/.claude/skills/web-fetch/` — ladder, verifier contracts, "ask memory
  first, report after"
- `packages/shared` — verifier signatures and result types (pure, fixture-testable)
- `packages/control-plane` — fetch-memory store, aggregation, admin queries
- `packages/provider/pod-base/podbay` — `fetch-plan` / `fetch-report` subcommands
- `packages/gateway` — relay socket, pairing, dispatch, rate cap
- `apps/web` — admin fetch-memory surface; cockpit relay status
- **new** `packages/pb` — the owner-side CLI, published as `@podbay/pb` (scope verified unclaimed
  2026-07-30), with `pb relay` as its only implemented subcommand so it slots into the existing
  `pb` plan (`docs/plans/entry-points-plan.md`) rather than becoming a second owner-side binary
- Supersedes the relay sketch in `docs/plans/web-data-acquisition.md:68-77` (which specified a
  control-plane long-poll) and closes `web-fetch-capability` task 7.1
