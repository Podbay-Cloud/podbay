# skills/survey/ — the shopping list

Per-source surveys of skills that *exist and are available*, each with a **decision** so we have a
good list to choose from without re-researching. This is upstream of the approved
[registry.yaml](../registry.yaml): a skill graduates from a survey into the registry only through
the vetting gate ([docs/skills-management.md](../../docs/skills-management.md)).

**Decision vocab:** `use-now` (bind to a current env/playbook) · `future` (useful for later
envs/playbooks) · `undecided` · `not-useful` (+ `why`). `last_updated` is captured at pin time.

| Survey | Source | License | Skills |
| --- | --- | --- | --- |
| [design.yaml](design.yaml) | skills.sh (cross-repo, install-ranked) | Apache/MIT | 6 (2 use-now) |
| [growth-marketing.yaml](growth-marketing.yaml) | coreyhaines31/marketingskills + others | MIT | 9 (4 use-now) |
| [vercel-agent-skills.yaml](vercel-agent-skills.yaml) | vercel-labs/agent-skills | MIT | 9 (2 use-now) |

**Discovery = `npx skills find <keyword>`** (skills.sh install leaderboard), per category, top-by-installs.
Install counts recorded per skill so we can re-sort. **installs = popularity, NOT safety** (skills.sh
is uncurated) — the vetting gate still decides what ships.

**Key findings (2026-07-16 sweep):**
- **frontend-design** (670K, top design skill) is available from **anthropics/skills @ Apache-2.0** —
  RESOLVES the earlier block (the `claude-code` copy is Commercial ToS; use the `anthropics/skills` one).
- **coreyhaines31/marketingskills** (MIT) dominates every marketing category — the core growth set for A.
- **cold-email** from coreyhaines beats coldoutboundskills on installs *and* has no lead-scraping scripts.
- **Landing / CRM / forms / dashboard** have NO dominant skill → compose design + copy + our own `crm-lite`.

## The broader vercel-labs landscape (there's a whole constellation)

`agent-skills` is only one of ~10 `vercel-labs` skill repos (enumerated via `gh` 2026-07-16). The
rest, with a quick decision — full surveys only if a decision warrants:

| Repo | What | Decision |
| --- | --- | --- |
| **design-systems-to-agent-skills** | A **generator** that turns a design system into an agent skill | **future — interesting**: point it at *our* shadcn design system to auto-author a first-party design skill |
| next-skills | (empty/WIP at main — recheck later) | undecided |
| migration-skills | `cra-to-next` migration | future/niche |
| vercel-kb-skills | webflow/netlify/tanstack → Vercel migrations | not-useful (we host, don't migrate to Vercel) |
| agentic-commerce-skills | universal commerce protocol | undecided (future commerce playbooks) |
| sitecore-skills · slack-agent-skill · academy-skills | Sitecore / Slack-on-Vercel / course material | not-useful now |
| skills · skills-handler | the CLI + its handler (tooling, not skills) | — (transport) |

## Reality check

The overall skills universe is **thousands** (the `skills` CLI installs from any repo; marketplaces
index 300+ marketing skills alone). We do **not** survey exhaustively — we survey **by relevance,
per source, decision-tagged**, so the shopping list stays a manageable curated set. Next surveys:
the community marketing/design repos (coreyhaines31/marketingskills ~large, OpenClaudia 34,
coldoutboundskills, Impeccable) — bigger, so they get their own files + a security review.
