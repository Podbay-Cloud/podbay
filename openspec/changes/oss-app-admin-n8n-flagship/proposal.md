## Why

**Status: PARKED — captured so it is not lost, NOT approved to build.** velsa has greenlit the
*direction* and asked for it to sit here as a todo behind the existing cleanup/fix backlog. Nothing in
this change may be implemented until he says so explicitly.

> **This change is DELIBERATELY proposal-only** (`openspec status` shows 1/4 artifacts, and
> `openspec validate` reports "no deltas found"). That is the correct state, not an omission to
> repair: design and spec deltas encode decisions — which capabilities exist, what behaviour is
> promised — and those decisions are velsa's and have not been made. **Do not add `design.md` or
> `specs/` to make the validator pass.** Write them when the change is actually picked up, after the
> open questions under *Impact* are answered.

The growth pod (`moderate-peacock-59a7`) proposes positioning Podbay as **"your own AI admin that
deploys and maintains self-hosted OSS apps for you — talk to it in Claude; run on our cloud or your
own hardware"**, beachhead = indie devs / small teams, competing with Coolify-style services,
PikaPods and Elestio.

Two things make this a genuinely new product direction rather than an extension, both verified
against the repo on 2026-08-27:

- **Self-host today deploys Podbay itself, nothing else.** The `curl | sh` → `docker compose up`
  path stands up the single-tenant dashboard + control plane on `LocalProvider`. There is no app
  catalog and no third-party app deployment anywhere in the codebase (no n8n / Ghost / Plausible /
  uptime-kuma references at all).
- **The closest existing concept is `environments/`** — five *agent workspace templates*
  (byo-project, doc-qa, first-10-customers, morning-ops-robot, nextjs-starter), each a prebuilt app
  plus skills plus a pre-authed agent. That is a different thing from hosting someone's OSS app, but
  it is the machinery a catalog would most plausibly grow out of, so any design should start there
  rather than from zero.

Current positioning is **agent-led** since 2026-08-10 ("Give Claude a real home"), which explicitly
superseded an environment-led lead. `docs/strategy/positioning.md` records that the env-marketplace
framing "needed a paragraph to land" where agent-led landed in one line — relevant prior art, because
an app-catalog story risks the same failure mode.

## What Changes

Nothing yet. This records the proposed scope for a later decision.

Proposed by the growth pod:

- **Flagship = n8n, end to end. "The demo is the product."** Nail one exact flow: user asks the admin
  in Claude → *deploy n8n* → live in minutes (Postgres + worker + TLS + backups) → *add a Slack node
  and an S3 backup* → done and tested → a CVE drops → the admin patches on a clone, verifies, rolls
  to prod, zero downtime.
- **A trust model, treated as the #1 objection.** Monitor upstream (Renovate) → auto-apply SAFE
  patches → ASK before risky ones (major / breaking / migrations) → one-click rollback. The promise
  is "never breaks your stack."
- **Both modes as a toggle** (Podbay cloud / your own box), with the architecture catalog-ready:
  n8n first, then Cal.com, Ghost, Chatwoot, Mautic, Umami, NocoDB, Twenty, Listmonk, Uptime-Kuma.

## Capabilities

### New Capabilities

None yet — deliberately. Naming capabilities here would imply a design that has not been reviewed.
A future `design.md` decides whether this is one capability (`app-catalog`) or several
(deploy / lifecycle-maintenance / rollback), and that choice should follow the open questions below,
not precede them.

### Modified Capabilities

None yet. Note for whoever picks this up: `self-host`, `dashboard`, `pod-boot` and `environment-spec`
are the surfaces most likely to change, and per `.claude/rules/edition-parity.md` anything touching
them is a two-edition event (cloud + OSS) — that rule is load-bearing for a feature whose whole pitch
is "our cloud or your box".

## Impact

Unresolved, and deliberately so. What must be settled BEFORE any build:

1. **Relationship to the agency design-partner sprint.** `docs/strategy/agency-design-partner-sprint.md`
   is marked *"Decision: selected by velsa on 2026-08-16"*, status *"ready for owner review; no
   outreach sent"*. It targets boutique automation consultants and positions Podbay as
   **complementing** n8n/Make — adjacent ground, a different beachhead, overlapping machinery. These
   two directions need reconciling by velsa, not by an agent picking one.
2. **Positioning conflict.** This would be a THIRD framing after env-led → agent-led. Whether it
   replaces, layers under, or targets a separate segment is velsa's call.
3. **The trust promise is the hard engineering, not the demo.** "Never breaks your stack" means
   automated upgrade classification, migration-aware rollout, verified rollback, and backup/restore
   that genuinely works — for arbitrary third-party apps. The demo flow is the cheap half.
4. **Operational surface.** Hosting other people's OSS apps means their CVEs, their data, their
   backups, and their uptime expectations. That is a materially different liability profile from
   "an always-on machine for coding agents" and should be costed before, not after.
5. **No adoption baseline exists.** No installs / stars / signup figures are recorded anywhere in the
   repo, and the waitlist form was removed (CTA is GitHub sign-in). Any sizing claim needs velsa's
   own numbers.

Sequencing per velsa (2026-08-27): this stays parked until the existing fix/branch/PR/test cleanup is
finished. See `0asks.md` for what is still owner-gated.
