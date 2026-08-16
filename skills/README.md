# skills/

The podbay skills supply chain. **`registry.yaml` is the hand-maintained AUDIT LEDGER** — the record
of which skills are approved, at what trust tier, by whom, when, and why. It is edited by hand in
PRs; **no script writes it**.

- **Model + flow:** [docs/plans/skills-management.md](../docs/plans/skills-management.md) (registry,
  trust tiers, vetting gate, "Dependabot for skills" update flow, backoffice phasing).
- **Behavior spec:** [openspec/specs/skills-registry](../openspec/specs/skills-registry/spec.md).
- **Never live-pull.** [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills`) is
  the transport + lockfile pin; the ledger is the policy. Only `audit.status: passed` skills may be
  bound.

## Where the files actually live

Vetted skills are vendored **into the environment that uses them** — `environments/<env>/.claude/skills/<id>/`
(or `environments/_shared/<profile>/.claude/skills/<id>/` when shared), each with a `SKILL.md` and a
`SOURCE.md` recording its upstream, pin, and license. Per-env `skills-lock.json` files carry the
`npx skills` transport pins (source repo + skillPath + content hash) — keep them; for some skills they
are the only record of the upstream pin.

## Seeing it all in one place

`pnpm skills:registry` joins this ledger with what actually ships and writes the typed index the
backoffice reads (`apps/web/lib/skills-registry.generated.ts`); `/admin/skills` renders it. The join
is what makes it useful — it flags skills that ship without an approval here, and ledger entries whose
files no longer exist. `pnpm skills:check` fails if the index is stale (enforced in the pre-push hook).

Adding a skill = a PR that vendors it at a pin + adds a ledger entry here, passes checks, and is
approved by vels at merge.
