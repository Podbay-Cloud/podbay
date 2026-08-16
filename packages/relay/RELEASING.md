# Releasing `relay`

`relay` ships to **two** places and both must move together, or the public source drifts behind
the shipped binary (it silently sat at 0.1.3 while npm was 0.1.7 once — a bad look for a tool
people audit before running on their own machine):

1. **npm** — `@podbay/relay`. Bump `version` in `package.json`, then `npm publish` from this dir.
2. **Public source mirror** — [`github.com/podbay-cloud/relay`](https://github.com/podbay-cloud/relay),
   with a git tag + GitHub Release per version.

For step 2, after bumping the version and writing the new `## <version>` section in
[`CHANGELOG.md`](./CHANGELOG.md), run from the repo root:

```bash
scripts/publish-relay-mirror.sh            # sync source → mirror, tag, cut the release
DRY_RUN=1 scripts/publish-relay-mirror.sh  # rehearse without pushing
```

It verifies the mirror builds and tests **standalone** before pushing, and excludes
`test/net-guard-parity.test.ts` (a monorepo-only invariant that can't run outside the workspace).
