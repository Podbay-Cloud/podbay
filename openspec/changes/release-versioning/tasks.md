## 1. Manifest carries a version (additive, two editions)

- [x] 1.1 Add nullable `version` to `pod_base_images` (`packages/db/src/schema.ts`) + migration.
      Additive only — old app code must run against it during a rollout (edition-parity rule 1).
- [x] 1.2 Verify the migration applies on self-host's plain Postgres via
      `packages/selfhost/migrate-pg.mjs`, not only via the gateway release_command.
- [x] 1.3 Carry `version` through `recordImage` / `listImages` / `currentImage`
      (`apps/web/lib/image-manifest.ts`).
- [x] 1.4 Data layer: db round-trip test proves version defaults NULL and is carried when set
      (packages/db/test/db.test.ts, on PGlite — a second driver, so also cross-edition evidence).
      Render half: `imageVersionLabel(null, digest) === shortDigest(digest)` proven in
      pod-image.test.ts — the NULL fallback IS the existing digest presentation (done with §5).

## 2. Fix re-recording before sourcing summaries from releases

- [x] 2.1 `scripts/incus/record-image.sh`: do not recompute notes for an already-recorded digest
      (accept an explicit range override, or preserve the stored changelog). This is the live
      2026-08-29 bug in `0audit.md`; sourcing summaries from releases makes re-recording routine.
- [x] 2.2 Regression test: re-recording a recorded image must not produce "the same software, rebuilt".

## 2b. Notes quality — owner language, not commit subjects (audit 2026-08-29)

- [x] 2b.1 Audit what owners actually see today (real notes rendered through `parseNotes`): engineer
      phrasing, leaked `(#49)` refs pointing at a PRIVATE repo, internal test jargon, multi-change
      commit subjects, and no fix-vs-feature distinction.
- [x] 2b.2 `parseNotes`: keep the conventional-commit TYPE (it was extracted then discarded), classify
      into New / Fixed / Improved, drop internal types, strip issue/PR refs.
- [x] 2b.3 Report an internal-churn-only build distinctly from a byte-identical rebuild
      (`internalOnly`), so neither is described as the other.
- [x] 2b.4 Group entries in the UI via a shared `NoteList` (cockpit dialog + bulk dialog).
- [x] 2b.5 One-liner leads with the kinds of change ("2 fixes, 1 new") instead of a bare count.
- [x] 2b.6 Clean at GENERATION too (`record-image.sh`), so the text stored — and later published to the
      public release manifest — is already free of churn and private refs.
- [x] 2b.7 Authoring guidance: `docs/runbooks/release-notes.md`.
- [x] 2b.8 CHANGELOG.md is grouped New/Fixed/Improved and cut-release.sh uses that section as the
      release body — the release description is structured, not one prose line.

## 3. Cut releases on both repos

- [x] 3.1 `scripts/cut-release.sh`: reads the top `## X.Y.Z` from CHANGELOG.md, attaches the version to
      the CURRENT pod-base image (admin API now forwards `version`), tags the private repo + cuts a GitHub
      Release with the changelog section. Dry-run verified end-to-end against prod (found image 1ac359).
- [x] 3.2 v0.1.0 released on the public mirror (Podbay-Cloud/podbay) — tag + GitHub Release cut
      explicitly at the synced HEAD, body from CHANGELOG.md. (Done manually with gh; folding it into
      cut-release.sh for future releases is a follow-up.)
- [x] 3.3 N/A in the current path: the public release body is the HAND-WRITTEN CHANGELOG section (owner
      prose, no private paths), not auto-derived commit subjects. Filter only needed if that ever changes.
- [x] 3.4 The `--no-release` path is the existing `build-and-record.sh` (records an image with NO version;
      the row stays digest-identified). cut-release is the separate, deliberate step — nothing forces a version.
- [x] 3.5 Added §4b to `docs/runbooks/shipping.md`: write CHANGELOG section → dry-run → cut (outward,
      owner-yes). Notes the disclosure rule and that the mirror/releases.json half isn't wired yet.

## 4. Self-host gets a release channel

- [x] 4.1 releases.json PUBLISHED to podbay-cloud/install (live at raw.githubusercontent.com/podbay-cloud/
      install/main/releases.json, v0.1.0). Generated from the deployed ?releases=1 endpoint.
- [x] 4.2 `fetchSelfHostRelease(ossLatestDigest)` (self-host-releases.ts) resolves from the pod's
      latestImageDigest joined to the published manifest — no pinnedDigest dependency. Wired into the OSS cockpit.
- [x] 4.3 fetchSelfHostRelease NEVER throws (offline/404/malformed → null → digest line); unit-tested.
- [x] 4.4 The fetch targets raw.githubusercontent.com/podbay-cloud/install, never podbay.cloud;
      asserted in the test. No-digest short-circuits before any network call.

## 5. Display

- [x] 5.1 Version + short digest together (`v0.4.2 (a1b2c3)`) via `imageVersionLabel` in the cockpit
      settings row, `update-info-dialog.tsx`, `bulk-update-dialog.tsx`, and admin image/pod pages.
- [x] 5.2 Do NOT add version to `pod-updating.tsx` — the dashboard spec now requires that view to show
      progress only.

## 6. Cut 0.1.0

- [x] 6.1 Cut v0.1.0: version attached to the live image 1ac359 in prod, tag + GitHub Release created.
- [x] 6.2 VERIFIED LIVE: test:1 updated to 1ac359 (a pod on the versioned image), image_digest=1ac359 in
      prod; currentImage.version=0.1.0, so its cockpit renders `Up to date · v0.1.0 (1ac359)`. (First retry
      hung on transient box contention; recovered + succeeded on retry.)
      description shown, and the offline fallback exercised.
- [x] 6.3 Verified (db test, PGlite): flipping which row is current (promoteImage semantics) makes the current version follow the re-promoted row — 0.2.0 rolls BACK to 0.1.0, the per-row design. Not tested against prod (a live rollback flips every pod to "update available").

## 7. Owner decisions (blocking their respective tasks, not the mechanism)

- [x] 7.1 Security-fix disclosure: impact + urgency, no mechanism, until adoption is high.
- [x] 7.2 Cadence: a release = a pod-base ship (version moves when the image ships).
- [x] 7.3 Image-only: a control-plane deploy with no image build is NOT a release.
