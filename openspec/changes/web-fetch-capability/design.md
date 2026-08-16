## Context

The full solution space is in [web-fetch-capability.md](../../../docs/plans/web-fetch-capability.md)
(the brainstorm, with live probe results). This design commits the v1 slice and the interfaces.

Existing pieces this builds on:
- `capabilities` is already an extensible object on the env schema (`browserTesting` is the first
  member) — a new `webFetch` member is a natural addition.
- Playwright/Chromium works on pods (2026-07-28 image fix) — Rung 1 rendering is available.
- The `.claude` layer ships via `buildInitFiles` at create AND now re-seeds on update — a skill
  reaches existing pods without an image rebuild.
- Egress enforcement (`egress-allowlist`) can block a rung silently, so sanctioned endpoints must be
  allowlist-eligible.
- The runtime rules already forbid the pod evading a block — this capability operationalizes the
  legitimate alternative rather than contradicting it.

## Goals / Non-Goals

**Goals:**
- Give research envs a fetch that actually works from a datacenter IP, without evasion.
- Ship the proven, zero-new-infra rungs (0 + 3) as v1.
- Make the ladder + guardrails a reusable skill, not per-env copy-paste.
- Keep every access credential owner-supplied; podbay ships capability, not access.

**Non-Goals:**
- The residential relay (Rung 4) — designed, deferred to the `pb` CLI fast-follow.
- Commercial residential-proxy pools — parked (values call).
- A generic "browse anything" agent — this is assisted, per-user, rate-limited research.
- Replacing env-specific research skills (customer-research etc.) — this is the fetch substrate they
  call.

## Decisions

**0. Four needs, not one.** "Scraping" decomposes into **search / read / watch / bulk**, each with a
different best answer (search API · the ladder · a feed+diff · an archive or licensed provider).
The skill leads with this because most requests that sound like "scrape X" are really watch or
search — both of which have answers that never touch a fragile page fetch. Merged from the parallel
`docs/plans/web-data-acquisition.md` session, along with "let the data come to you" (RSS/Atom first,
webhooks, email-in) as a pre-ladder step.

**1. A skill, not library code.** The ladder is judgment ("can Rung 0 serve this? if not, escalate")
plus a fixed set of guardrails — exactly what a skill encodes well, versioned + registry-tracked +
Codex-translatable. Env-specific research skills call it; it doesn't replace them.

**2. Universal skill, gated by an env capability flag.** The skill lives in `_shared/universal` so
any env can use it, but the agent only reaches for it when the env declares `capabilities.webFetch`.
Off by default: a plain code env has no business fetching the web unprompted.

**3. v1 = Rung 0 (APIs) + Rung 3 (reader services). Rung 1 is implicit** (plain fetch already works
for open sites). Rung 2 (archives) is documented as available but not a required implementation.
Rung 4 (relay) is designed in this doc, built later.

**4. Jina Reader as the default Rung-3 reader** (`GET https://r.jina.ai/<url>` → markdown), proven
keyless from a pod; an owner key raises limits. Firecrawl/ScrapingBee are alternates for structured
extraction/volume, selected via a secret + a small config the env sets. The skill treats the reader
as pluggable.

**5. Secret contract, owner-set.** Keys and relay endpoints are pod secrets (already the mechanism
for `$TELEGRAM_BOT_TOKEN` etc.). The skill reads them from the environment; absent a key it falls to
the keyless tier or says so. Names namespaced `WEBFETCH_*` where podbay-defined; source-native names
(`REDDIT_CLIENT_ID`) kept where the source dictates.

**6. Egress-aware.** The sanctioned reader hosts (`r.jina.ai`, chosen service) and the relay host
are allowlist-eligible entries. Under a locked-down egress policy the env must include them, or the
rung is (correctly) blocked. The skill surfaces "blocked by egress" distinctly from "site said no."

**7. The relay (Rung 4a), specified for the fast-follow.** A local process the owner runs
(`relay`, riding the CLI auth) holds an outbound connection to the control plane / gateway; the
pod dispatches a fetch task, the laptop executes it from the owner's own IP and returns the result.
Outbound-only, no inbound ports — the same trick Claude Remote Control uses. Clean because it is the
owner's own device fetching sites they may lawfully visit, orchestrated (not faked) by the pod.

**The consent model IS the product** (merged from the parallel `web-data-acquisition.md` session,
which designed this better than the first pass did). The pod is **semi-trusted by design**: the
relay must stay safe even if a pod's agent misbehaves or is prompt-injected by a fetched page. So
the blast radius is bounded by construction, not by good intentions:
- **Per-domain allowlist the owner edits** (`relay allow example.com`) — nothing else is fetchable.
- **Visible task log** — the owner sees every fetch their machine performed, after the fact.
- **Optional confirm-each mode** for the cautious, plus **rate caps** and a **kill switch**.
- **Fetch-only.** No arbitrary shell, no writes — the relay executes retrievals, nothing else.

**Power ladder, by increasing ToS risk** — build in order, stop where the risk stops being worth it:
- **v1** plain fetches from the laptop's IP (covers datacenter-block cases)
- **v2** headless browser on the laptop for JS-rendered pages
- **v3** the owner's REAL browser profile via extension — unlocks logged-in contexts and is exactly
  where ToS risk concentrates. **Per-site explicit opt-in or not at all**, and never for platforms
  that ban automation of an account.

Built when the CLI lands; the differentiator claim is real — no competitor's cloud sandbox can say
"the last mile can run from YOUR machine, visibly, under your rules."

## Reality check — what actually works (probed 2026-07-28, corrects the initial optimism)

Vels (with real scraping experience) pushed back; probes confirmed the pushback:

- **Reader services are NOT universal.** Jina keyless = **20 req / 60s** (rate-limited). And it
  **fails on Cloudflare-bot-managed sites**: `g2.com` → "requiring CAPTCHA", `crunchbase.com` →
  "Just a moment…" (CF challenge). It returned the *challenge page*, not the content. Every reader
  service (Jina, Firecrawl, ScrapingBee, Bright Data) hits this — CF bot-management is a permanent
  arms race and the hard targets (G2, Crunchbase, LinkedIn, Google) fight hardest.
- **Rung 3 is clean only for the OPEN ~80%** — company sites, docs, product/landing pages, news,
  HN, GitHub. That IS most real research. It is NOT a scrape-anything solution and must not be sold
  as one.
- **Cloudflare's own Browser Rendering is not a bypass** — it egresses from CF datacenter IPs and
  is challenged by a target's CF protection like any bot. It's a render service, not a CF skeleton
  key. Not adopted for that purpose.
- **A rotating residential-proxy pool is the wrong bet for podbay** — expensive, STILL loses to CF's
  behavioral/fingerprint challenges, ethically murky (whose IPs?), and makes podbay the *operator*
  of scraping infra, contradicting the runtime rule "never evade a block". Excluded, not just parked.

**Reframe of the relay's value (Rung 4).** Its point is NOT beating CF. It runs in the owner's own
browser/session, so the agent fetches **with the owner's identity, cookies, and permissions** —
reaching *logged-in* content the owner is entitled to (their CRM, their authenticated tools), which
no proxy pool can do and which is cleaner (it is literally the user, not an impersonation). DC-block
relief is a side effect; "act with the user's own access" is the headline.

**Product positioning (decided by this pushback):** podbay does NOT compete on "scrape any site
invisibly" — that's undeliverable and dishonest. It competes on a research-competent agent that
(a) uses front-door APIs + clean readers for the open web, (b) acts through the user's own
browser/session for gated content, and (c) is HONEST when a target is fortified — reporting "this is
CF-protected; the legit paths are its official API, an export, or your own logged-in browser"
instead of flailing on a challenge page. Honesty-and-competence is the feature, not fake omniscience.

## Risks / Trade-offs

- **Third-party dependency & cost.** Rung 3 leans on an external service (uptime, pricing, their own
  ToS). Mitigated: keyless Jina tier as the floor; the reader is pluggable; a failed rung degrades
  to "couldn't fetch, here's why," never to evasion.
- **The guardrails are prose the agent must honor.** A skill can be ignored more easily than code.
  Mitigated by the runtime rule (never evade) sitting ABOVE it in the CLAUDE.md, and by keeping the
  skill's guardrails short and imperative.
- **Capability creep / abuse.** "Research the web" is powerful. Bounded by: opt-in per env,
  per-user/rate-limited framing, no bulk, owner-supplied credentials (cost is a natural throttle),
  and the standing no-evasion rule.
- **Relay security (future).** A CLI token that lets a pod drive fetches from the owner's home IP is
  real attack surface — scope it to fetch-only, owner-initiated, revocable. Designed here, reviewed
  when built.
- **"Works because Jina works today."** If a reader service starts blocking datacenter callers, the
  rung degrades. Acceptable: the ladder has multiple rungs, and the relay is the ultimate fallback.
