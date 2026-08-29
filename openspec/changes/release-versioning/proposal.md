## Why

Podbay has **no version**. Every workspace package is `0.0.0`, the repo has **zero git tags**, and no
release workflow exists (`.github/workflows/` has ci, dco, oss-mirror, public-ci, selfhost-images —
none tags or releases). What an owner sees as "version" is a 12-char image digest and a build date
(`pod-cockpit.tsx:1493` → `Up to date · a1b2c3d4e5f6`, or `Version unknown`). The sole exception is
`@podbay/relay`, which already ships real semver (0.2.3) with the repo's only `CHANGELOG.md`.

Two concrete failures follow from that:

1. **Self-host owners get no changelog at all.** `updateInfo` is structurally always `null` in OSS:
   it requires `pinned`, and `pinnedDigest()` (`apps/web/lib/pod-image.ts:16-20`) only resolves from
   `PODBAY_INCUS_IMAGE_DIGEST` / `PODBAY_BASE_IMAGE`, neither of which the Docker `LocalProvider`
   sets. So the cockpit falls through to `oss && !updateInfo` and renders
   `New pod-base available · abc123 → def456` (`pod-cockpit.tsx:1480-1487`). The code comment states
   it plainly: *"no release-notes manifest, so show the concrete from→to build digests (that IS the
   version info here)"*. A self-hoster deciding whether to take an update is shown two hex strings.

2. **Owners cannot name what they run.** Support, bug reports, docs and release announcements have no
   shared noun. "Which version?" has no answer but a digest, and digests are unquotable and
   unorderable by eye — you cannot tell from `b98693f4` vs `fd855702` which is newer.

The **data model already supports the fix**: `pod_base_images` carries `summary` (human, leads the UI)
and `notes` (git-derived, demoted to a collapsed "technical changes"), and the image-manifest spec
already requires summary-first-notes-second. What is missing is (a) a stable version label, (b) a
publishing step that produces release descriptions deliberately rather than as a build-time
afterthought, and (c) any channel at all to self-host.

## What Changes

**A release is a tagged commit that produces artifacts.** Versions start at **0.1.0** — honest for
pre-Alpha, leaves room to break things without a major bump, and consistent with relay's 0.x line.

- **Version is a label on the image row, never an identity.** The 64-char digest remains what
  determines what boots (the `pod-base` alias is the launch pin) and what all comparison logic uses.
  `pod_base_images` gains a **nullable** `version` column; existing rows keep `NULL` and display falls
  back to today's digest line. Rollback keeps working *because* version is stored per-image:
  re-promoting an older image correctly shows the version going backwards, which a version computed
  from `HEAD` could never do.
- **Not every build is a release.** An ad-hoc rebuild still produces a new digest; it inherits the
  current version rather than burning a patch. Version is therefore **not unique per digest**, which
  is a deliberate decision recorded here rather than an accident discovered later.
- **`summary` is sourced from the release description** instead of being passed ad-hoc at build time.
  `notes` stay auto-derived from the commit range — they are the honesty layer (they are what
  correctly say "the same software, rebuilt") and a hand-written description must not be able to
  silently replace them.
- **Self-host gets a fetchable channel**: a static `releases.json` published to the existing public
  `podbay-cloud/install` mirror (already produced by `scripts/publish-install-mirror.sh`). One fetch
  from a public host, no API rate limits, and it degrades to today's digest line when offline or
  air-gapped. Baking notes into the image was rejected: it describes what you are *running*, but the
  update modal must describe what you would *get*, before the image is pulled.
- **Releases are cut on both repos**, private and public mirror, following the pattern
  `scripts/publish-relay-mirror.sh:82-89` already uses (tag + `gh release create` with notes from a
  CHANGELOG). The mirror is a squashed one-way export, so tags do not transfer and must be created
  against the mirror explicitly.
- **Version is displayed** wherever the digest is today, with the digest retained for support:
  `Up to date · v0.4.2 (a1b2c3)`.

### Explicit non-goals

- **Not versioning internal packages.** They stay `0.0.0`; they are private and never published. Only
  the *release* is versioned. `@podbay/relay` keeps its own independent npm line.
- **Not one version for all four artifacts.** pod-base (Incus), ghcr `pod-base`/`pod-app`, the Fly
  web+gateway control plane, and relay ship on different clocks — gateway must deploy before web for
  a schema change, and the image builds independently. A single number would routinely misdescribe
  what a given pod runs. The release records *which artifacts it produced*; a pod displays the version
  of the image it runs.
- **No auto-publishing of releases.** Cutting a release stays a deliberate human act.

## Capabilities

### New Capabilities
- `release-versioning`: how a release is cut, versioned (semver from 0.1.0), described, tagged on both
  repos, and how that description reaches an owner in BOTH editions.

### Modified Capabilities
- `image-manifest`: a recorded image MAY carry a version label; version is additive to the canonical
  digest and never replaces it as identity; `summary` is sourced from the release description.
- `self-host`: a self-host install SHALL be able to learn what is in an update beyond the from→to
  digests, via a published static manifest, degrading to digests when unreachable.

## Impact

**Code**
- `packages/db` — new nullable `version` column on `pod_base_images` + migration. Per edition-parity
  rule 1 this is a two-edition, two-timing event: additive and backward-compatible, gateway deploys
  before web, and it must apply on self-host's plain Postgres via `packages/selfhost/migrate-pg.mjs`.
- `apps/web/lib/image-manifest.ts` — carry `version` through `recordImage`/`listImages`/`currentImage`.
- `apps/web/components/update-info-dialog.tsx`, `bulk-update-dialog.tsx`, `pod-cockpit.tsx` — display
  version alongside the digest. (`pod-updating.tsx` deliberately shows no changelog — see the
  dashboard spec's update-progress requirement.)
- `apps/web/lib/pod-image.ts` — an OSS path to update info that does not depend on `pinnedDigest()`.
- `scripts/incus/record-image.sh` — accept a version; stop recomputing notes for an already-recorded
  digest (the re-record bug in `0audit.md`, hit live 2026-08-29).
- `scripts/publish-install-mirror.sh` — publish `releases.json`.
- New: a release script (tag → changelog → `gh release` on both repos), modelled on
  `scripts/publish-relay-mirror.sh`.

**Risks to design against**
- **Disclosure.** Public release notes describing a security fix are a disclosure channel, published
  before self-hosters have updated. Needs a stated policy for security-relevant entries.
- **Mirror leakage.** `scripts/oss-mirror.sh:22-40` excludes `scripts/incus`, `docs/runbooks`,
  `docs/strategy`, `CLAUDE.md`. Notes auto-derived from commit subjects can reference that private
  context; the gitleaks gate scans for *secrets*, not private path names.
- **A hard summary gate adds friction.** `record-image.sh:69-74` currently only *warns* when a
  real-change build has no summary. Making the description a release requirement improves quality but
  needs a documented hotfix escape hatch.
- **Version/digest drift.** Because untagged rebuilds inherit a version, two digests can share one
  version. Every surface must show the digest next to the version so support can still disambiguate.
