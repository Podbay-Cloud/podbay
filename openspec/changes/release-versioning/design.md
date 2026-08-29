## Context

Podbay ships four artifacts on four independent clocks:

| Artifact | Published by | Identity today | Consumers |
|---|---|---|---|
| pod-base Incus image | `scripts/incus/build-and-record.sh` | 64-char digest, `pod-base` alias | cloud pods |
| ghcr `pod-base` + `pod-app` | `.github/workflows/selfhost-images.yml` (manual dispatch) | `latest` tag | self-host |
| Fly `podbay-web` + `podbay-gateway` | `scripts/deploy-app.sh` | Fly release number | the cloud control plane |
| `@podbay/relay` | `scripts/publish-relay-mirror.sh` | **real semver, 0.2.3** | owners' machines |

Only the last has a version. The repo has no tags, no release workflow, and every package is `0.0.0`.

The manifest already models the right *shape* — `summary` (human, leads) + `notes` (git-derived,
demoted) — and `openspec/specs/image-manifest/spec.md` already requires summary-first. So this change
is mostly about **identity** (a name for a release) and **reach** (self-host currently gets nothing),
not about redesigning how update text is presented.

## Goals / Non-Goals

**Goals**
- A stable, orderable, quotable name for what an owner runs.
- Self-host learns what is in an update, not just two hex strings.
- Release descriptions written deliberately, not as a build-time afterthought.
- Rollback keeps working, including the version going backwards.

**Non-Goals**
- Versioning internal packages (they stay `0.0.0`; relay keeps its own line).
- One number describing all four artifacts.
- Automating the decision to cut a release.
- Replacing the digest anywhere in comparison, pinning, or provider logic.

## Decisions

### 1. Version labels an image row; the digest stays identity

`pod_base_images` gains a **nullable** `version`. Everything that decides *what boots* — the
`pod-base` alias, `PODBAY_INCUS_IMAGE_DIGEST`, `sameDigest` normalization, prune protection —
continues to use the canonical 64-char digest, unchanged.

Storing version **per image row** (rather than deriving it from `HEAD` or a tag at read time) is what
makes rollback correct: re-promoting a superseded image must display *its* version, which is lower
than the one it replaced. A derived version could only ever move forward.

Existing rows stay `NULL` and render exactly as today. This is the backward-compatible half of
edition-parity rule 1: old app code runs fine against the new column during a rollout.

### 2. Not every build is a release

An ad-hoc rebuild (a pod-base rebuild with no image-affecting commits, or a hotfix build) produces a
new digest and **inherits the current version**. Consequences, accepted deliberately:

- **Version is not unique per digest.** Two digests can carry `v0.4.2`.
- Therefore **every surface showing a version also shows the digest** — `v0.4.2 (a1b2c3)` — so support
  can still disambiguate. The digest is never dropped from the UI, only demoted.

The alternative (every build burns a patch) was rejected: it makes the number churn faster than the
software changes, which is exactly the failure that makes a version less useful than a digest.

### 3. `summary` comes from the release description; `notes` stay derived

`notes` are auto-derived from the commit range and are the **honesty layer** — they are what correctly
produce "the same software, rebuilt" for a no-op rebuild. A hand-written description must never be
able to silently replace them, only lead them. This preserves the existing summary-first/notes-second
contract in `image-manifest`, and keeps `parseNotes`'s empty-case detection meaningful.

Corollary: the re-record bug (`record-image.sh:38-63`, registered in `0audit.md`) must be fixed as
part of this, because sourcing `summary` from a release makes re-recording a *normal* operation rather
than the rare accident it was when it produced false "no changes" notes on 2026-08-29.

### 4. Self-host reads a published static manifest, not an API and not the image

Three options were considered:

| Option | Pre-update preview? | Offline | Rate limits | Verdict |
|---|---|---|---|---|
| Bake notes into the image | **No** — describes what you run, not what you'd get | yes | n/a | rejected |
| GitHub Releases API | yes | no | unauthenticated limits | rejected |
| Static `releases.json` on the public install mirror | yes | degrades cleanly | none | **chosen** |

The decisive constraint is that an update modal must describe an image the pod **has not pulled yet**,
which rules out reading the artifact itself. `scripts/publish-install-mirror.sh` already publishes to
`podbay-cloud/install`, so this adds a file to an existing pipeline rather than a new service. Self-host
never calls podbay.cloud — the fetch targets a public repo, and failure degrades to today's digest line.

### 5. Releases are cut on both repos, mirror-style

`scripts/publish-relay-mirror.sh:82-89` already does tag + `gh release create` with notes extracted
from a CHANGELOG, against a public mirror. That pattern is copied rather than reinvented. Because
`scripts/oss-mirror.sh` is a **squashed one-way export**, git tags do not carry over; the mirror is
tagged explicitly against its own history.

### 6. OSS update info stops depending on `pinnedDigest()`

`updateInfo` is `null` in OSS purely as a side effect of `pinnedDigest()` reading cloud-only env vars
(`apps/web/lib/pod-image.ts:16-20`). The OSS path resolves its target from `latestImageDigest()`
(already implemented, `packages/provider/src/local/provider.ts:293-295`) joined to `releases.json`.
This is the edition-parity rule 2 correction: a shared component currently leaves one edition on a
code path that assumes cloud.

## Risks / Trade-offs

- **Disclosure window.** Public release notes describing a security fix reach attackers before
  self-hosters have updated. Today's RC-off orphan fix is a live example — "remote control could be
  silently disabled" tells a reader where to look. **Resolved** (see Decisions): a public security
  note states impact + urgency but not the mechanism/file until adoption is high; detail follows later.
- **Mirror leakage.** Auto-derived notes are commit subjects, and the mirror excludes `scripts/incus`,
  `docs/runbooks`, `docs/strategy`, `CLAUDE.md` (`oss-mirror.sh:22-40`). A subject can name private
  context; the gitleaks gate scans for secrets, not private path names. Mitigation: filter notes
  through the same exclusion list before publishing to `releases.json`.
- **Friction on hotfixes.** Making a description mandatory improves quality but blocks a 2am fix.
  Mitigation: an explicit `--no-release` build path that records an image with inherited version and
  derived notes only — the current behaviour, kept as the escape hatch rather than removed.
- **A version implies a promise.** Starting at 0.1.0 (not 1.0.0) keeps the pre-Alpha signal honest and
  leaves breaking changes cheap.
- **Two more publish steps to keep in sync** with `docs/runbooks/shipping.md`, which is already the
  single prescriptive checklist. If release cutting is not added there, it will be reassembled from
  memory — the exact failure that runbook exists to prevent.

## Migration Plan

1. Additive nullable column + migration. Gateway deploys **before** web (schema change, enforced by
   `scripts/check-migrations.sh`). Confirm it applies on self-host's plain Postgres via
   `packages/selfhost/migrate-pg.mjs`, not only via the gateway release_command.
2. Ship display code that treats `version` as optional — every existing row is `NULL`, so the digest
   fallback must be the tested default, not an afterthought.
3. Cut `v0.1.0` against the current state; backfill nothing (history stays digest-identified).
4. Publish the first `releases.json`; verify a self-host install renders it AND that it degrades to
   the digest line when the file is unreachable.

## Decisions (resolved 2026-08-29)

- **Security-fix disclosure (was 7.1): impact + urgency, no mechanism, until adoption is high.** A
  public release note for a security fix states what is affected and how urgent, but not the file or
  mechanism, until most self-hosters have updated; detail can follow later. Public notes reach an
  attacker the moment they reach an un-updated self-hoster, so this is the responsible-disclosure
  default. Owners still learn to update urgently.
- **Cadence (was 7.2): a release = a pod-base ship.** The version moves exactly when the thing owners
  run changes, and every shipped image carries a version. No periodic batching.
- **Scope (was 7.3): image-only.** A release versions the pod IMAGE. A control-plane (Fly web/gateway)
  deploy with no image build is NOT a release — the control plane deploys continuously and is not what
  a pod "is", so folding it in would make the version describe something the owner cannot see on their
  pod. A release still records which artifacts it produced; a pod displays its image's version.
