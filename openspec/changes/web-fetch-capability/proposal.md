## Why

Podbay's research-flavored envs need a real "fetch and understand a web page" ability, and they
don't have one. first-10-customers already ships `customer-research`, `prospecting`, `seo-audit`,
and `cro` skills — all of which assume the agent can read a prospect's site — yet a pod egresses
from a **datacenter IP** that many sites block at the edge, and the runtime rules (correctly) forbid
the pod from evading a block by faking a browser. So today those skills quietly degrade: the agent
either gets a 403 it can't explain, or "works on my laptop" confusion. The doc-QA/CRM-prep flow
(read a landing/product page → structured fields) and the ops bot (domains, dedicated-server feeds,
monitored pages) have the same need.

The brainstorm ([web-fetch-capability.md](../../../docs/plans/web-fetch-capability.md)) established
that the capability is very achievable **without** evasion: change WHERE the fetch originates or WHAT
we read. Probed live from a pod: official APIs (HN/RDAP/GitHub keyless; Reddit/Brave key-gated),
published archives (Common Crawl reachable), and — the key result — **third-party reader services
fetch from their own infra**: `r.jina.ai` returned the JS-heavy Hetzner auction page as clean
markdown, 200 OK, from a datacenter IP.

## What Changes

- A new universal **`web-fetch` skill**: a resolution LADDER the agent walks per request, cheapest
  and cleanest first — (0) official/structured APIs, (1) direct pod fetch + Playwright render for
  non-blocking sites, (2) published archives/datasets, (3) third-party fetch/reader services that
  own the IP + ToS posture, (4) the owner's own residential egress via a local relay. The skill
  encodes when to escalate and, crucially, the **guardrails** (official-first, per-user/rate-limited,
  respect robots/ToS/a "no", never rotate the pod's identity to evade).
- An env **`capabilities.webFetch`** declaration (default off) so an env opts in and states which
  rungs it may use; the launch UI / capability summary surfaces it.
- A **secret contract** for the keys and relay endpoints the higher rungs need (owner-set pod
  secrets: e.g. `WEBFETCH_JINA_KEY`, `REDDIT_CLIENT_ID/SECRET`, `WEBFETCH_RELAY_URL`) — podbay ships
  the skill, the owner supplies the access.
- **Egress-allowlist** entries for the sanctioned fetch services / relay, so the capability works
  under egress enforcement rather than being silently blocked by it.
- **BREAKING for the relay rung only:** Rung 4 (local residential relay) is **designed here but
  deferred to a fast-follow** — it depends on the `pb` CLI auth spine (entry-points-plan.md) that
  isn't built. v1 ships Rungs 0 + 3 (both proven, no new infra) + the guardrail framing.

Explicitly NOT in scope: commercial residential-proxy pools (renting third parties' IPs) — a values
call parked as a deliberate opt-in, never a default; any evasion path.

## Capabilities

### New Capabilities
- `web-fetch`: the ladder of legitimate methods for fetching and researching public web content
  from a pod, the guardrails that keep it ToS-clean and off blocklists, and how an env opts in.

### Modified Capabilities
- `environment-spec`: envs declare `capabilities.webFetch` (which rungs, default off).
- `egress-allowlist`: the sanctioned fetch services and relay endpoints are allowlist-eligible so
  the capability functions under egress enforcement.

## Impact

- `environments/_shared/universal/.claude/skills/web-fetch/` (new skill + registry entry) — or a
  `research/` skill wired into first-10-customers first; decided in design.
- `packages/shared/src/schema.ts` — the `capabilities.webFetch` shape.
- Egress config — allowlist entries for Jina/reader services + the relay host.
- Ships via the `.claude` layer (deploy + seed-on-update), NO image rebuild for the skill/rules; the
  schema change is a web deploy. The relay rung, when built, rides the `pb` CLI + gateway WebSocket.
- Owner-facing: new optional pod secrets (keys/relay) documented per env that enables the capability.
