# Contributing to podbay

Thanks for wanting to improve podbay. This page explains how contributions flow and the one legal
requirement (a DCO sign-off).

## How the repos work

The public repo you're looking at is a **mirror** of podbay's development monorepo. Development and the
authoritative history live upstream; this mirror is where the community reads the code and proposes
changes. That means:

- **Issues and PRs are welcome here** on the public repo.
- Your PR is **imported into the upstream monorepo**, where the full build, unit tests, end-to-end
  tests, and review run. On green + approval it's merged upstream and flows back out to this mirror on
  the next sync — with your authorship preserved.
- Because of that round-trip, a merged change may appear here as part of a sync commit rather than your
  PR being "merged" in the GitHub UI. Your commit and credit are kept intact.

## Developer Certificate of Origin (DCO) — required

Every commit must be signed off, certifying you have the right to submit it under the project's license
(see the [DCO](https://developercertificate.org/)). Add a sign-off line to each commit:

```
git commit -s -m "your message"
```

This appends `Signed-off-by: Your Name <your@email>`. PRs without sign-off can't be merged (the license
is BSL and converts to Apache-2.0 over time — the DCO is what keeps that relicensing clean).

## Before you open a PR

- **Discuss big changes first** in an issue — since PRs are validated upstream, a quick alignment saves a
  round-trip.
- **Keep it focused** — one logical change per PR.
- **Match the surrounding code** — style, naming, and comment density.
- **Tests** — add or update tests for behavior changes; the upstream gate runs them.
- **Don't include** secrets, credentials, or infrastructure-specific config.

## What lives here vs. what doesn't

This mirror is the runtime + application source under [BSL](LICENSE). Some operational pieces (managed
fleet orchestration, deploy configuration, internal runbooks) are intentionally not mirrored — they're
not needed to run or modify podbay yourself. If you hit a gap that blocks self-hosting, open an issue;
that's a bug in the boundary, not a "no".

## License of contributions

By contributing, you agree your contribution is licensed under the project's license
([`LICENSE`](LICENSE)), and your DCO sign-off certifies you may do so.
