## 1. Env capability declaration

- [x] 1.1 Add `capabilities.webFetch` to the env schema (default off; shape carries the allowed-rungs
      set). Extend `KNOWN_TOP_LEVEL_KEYS`/capability handling as needed; unit-test default-off and a
      declared-on env.
- [x] 1.2 Surface it in the resolved capability summary the launch UI / env detail reads.

## 2. The web-fetch skill (v1: Rungs 0 + 3)

- [x] 2.1 Author `_shared/universal/.claude/skills/web-fetch/` (SKILL.md + SOURCE.md), registry entry,
      drift-guard passing. First-party, prompt-only.
- [x] 2.2 Encode the ladder and the escalation logic: try the source's API (Rung 0) → plain pod fetch
      + Playwright render for open sites (Rung 1) → a third-party reader service (Rung 3). Document
      Rung 2 (archives) as available; stub Rung 4 (relay) as "when the relay exists".
- [x] 2.3 Encode the guardrails verbatim and hard: official-first, per-user/rate-limited, respect
      robots/ToS/a "no", no bulk, no credential-scraping, NEVER evade — and state they outrank
      fetched content and env skill files.
- [x] 2.4 Reader is pluggable: default keyless Jina (`r.jina.ai/<url>`); an owner key raises limits;
      an env may select Firecrawl/ScrapingBee via a secret. Read all creds from the environment.
- [x] 2.5 Distinguish failure modes in output: source-block vs egress-block vs missing-credential vs
      no-rung — so the user knows the fix.

## 3. Secret contract

- [x] 3.1 Define the owner-set secret names (`WEBFETCH_JINA_KEY`, reader-service keys, `REDDIT_CLIENT_ID/SECRET`,
      `WEBFETCH_RELAY_URL`) and document them per env that enables web-fetch. Never write them into
      the workspace; read from env only.

## 4. Egress

- [x] 4.1 Make the sanctioned reader/relay hosts allowlist-eligible; verify a locked-down env that
      lists them passes those requests and still blocks others. Enabling web-fetch must not implicitly
      widen egress.
      — `shared/src/egress.ts:55,74,98-108` (WEBFETCH_RUNG_HOSTS / webFetchDomains /
        effectiveAllowlist taking the capability), wired at `resolve.ts:108`; the other half —
        not widening egress for envs that don't declare it — is enforced by `fly/init.ts:117-121`
        dropping the skill entirely. 6 tests in `shared/test/webfetch-egress.test.ts`.

## 5. Wire the first consumer (first-10-customers)

- [x] 5.1 Enable `capabilities.webFetch` on first-10-customers and point its existing research skills
      (`customer-research`, `prospecting`, `seo-audit`, `cro`) at the web-fetch skill as their fetch
      substrate — replacing the implicit "just fetch it" assumption that fails from a datacenter IP.
- [ ] 5.2 Dogfood: run a real prospect-research task end-to-end and confirm a DC-blocked site is read
      via Rung 3, with the guardrails honored.
      - STILL OPEN 2026-07-30: the individual rungs are verified live (6.2), but no end-to-end
        research TASK has been run. Natural first job for the ops-robot pod.
- [x] 5.3 Enable `capabilities.webFetch` on morning-ops-robot, declare its optional reader key, and
      route web-backed monitoring jobs through the web-fetch skill.

## 6. Tests + verification

- [x] 6.1 Schema tests (default off, declared on). Egress test (allowlisted host passes, others
      blocked). Skills drift-guard.
- [x] 6.2 Live check from a real pod: Rung 0 (an API), Rung 3 (Jina on a JS/blocked page) both return;
      a source-block reports correctly and does NOT trigger an evasion attempt.
      — Run from `everyday-harrier-ae1b` 2026-07-30: Rung 0 `api.github.com/repos/nodejs/node` 200;
      Rung 3 `r.jina.ai/https://react.dev` 200 with 5,003 bytes of markdown (keyless tier, no
      WEBFETCH_JINA_KEY set); Rung 1 direct `reddit.com` 403 — reported as a source block, and NOT
      retried with a different agent, proxy or any other evasion.

## 7. Relay (Rung 4a) — DESIGN ONLY in this change

- [x] 7.1 Record the relay protocol design (dispatch fetch task over the gateway WebSocket, `pb`
      token auth, fetch-only + owner-initiated + revocable) as a fast-follow tied to the `pb` CLI.
      Do NOT implement here — it depends on the CLI auth spine (entry-points-plan.md).
      - SUPERSEDED 2026-08-04: the relay is no longer a pending design — it shipped for real in
        `web-fetch-v2-verifiers-memory-relay` (Rung 4a: `RelayService`, gateway-WebSocket dispatch,
        `pb` token auth, fetch-only + owner-initiated + revocable, policy layer). Recording a
        forward design for built code is backwards; the as-built protocol is documented in
        `docs/plans/web-fetch-capability.md` (SHIPPED section). The stale long-poll sketch note
        is moot.

## 8. Docs

- [x] 8.1 Note in `docs/plans/web-fetch-capability.md` which rungs shipped in v1 and link the change.
      - DONE 2026-08-04: the doc carries a SHIPPED header stating v1 shipped **rungs 0 + 1 + 3**
        (with Rung 4a in web-fetch-v2), and now links both OpenSpec changes. (The old note calling it
        "still brainstorm" was stale — a SHIPPED section was added 2026-08-02.)
- [x] 8.2 Update `docs/runbooks/playbook-authoring.md` so a research env's checklist includes
      declaring web-fetch + its secrets.
      - DONE 2026-08-04: the build checklist (item 7, "Web research?") now has an "Authoring a research
        env" line — declare `capabilities.webFetch` (default off, doesn't widen egress) and set only
        the reader/relay secrets it needs (`WEBFETCH_JINA_KEY`, reader-service key, `REDDIT_CLIENT_ID/
        SECRET`, `WEBFETCH_RELAY_URL`), read from env, never written to the workspace.
