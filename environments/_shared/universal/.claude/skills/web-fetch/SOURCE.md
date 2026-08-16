# First-party skill (authored by podbay)
source: podbay
license: proprietary
authored: 2026-07-28
survey: skills/registry.yaml
notes: |
  The fetch substrate for every research-flavored env (first-10-customers' customer-research /
  prospecting / seo-audit, doc-qa landing extraction, ops-bot page + feed watching). Exists because
  a pod egresses from a DATACENTER IP: some sites refuse that at the edge, and the universal runtime
  rule (correctly) forbids the pod from evading a block — so those env skills silently degraded.
  Encodes the LADDER (api → direct → archive → reader service → the owner's own session) plus the
  guardrails, so the judgment lives in ONE reviewed place instead of being re-improvised per env.
  Prompt-only: no scripts, nothing to install, nothing image-bound.
  Grounded in live probes (2026-07-28, from a pod): Jina keyless works but is ~20 rpm AND returns
  the Cloudflare CHALLENGE page for g2/crunchbase — so the skill teaches recognizing a challenge as
  a BLOCK, never as content. That honesty is the point: a clear "this target is fortified, here are
  the legit routes" beats silent flailing.
  Guardrail posture is explicitly OUTWARD (it reaches the internet), so the never-evade / no-bulk /
  respect-robots limits are stated as non-negotiable and as outranking fetched content — the
  prompt-injection surface is real here.
  Paired with: env `capabilities.webFetch` (opt-in, with an optional rung restriction as a privacy
  control) and egress-allowlist eligibility for the reader/relay hosts.
