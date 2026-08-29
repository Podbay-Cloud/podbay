# Changelog

Owner-facing release notes for Podbay pods. Each version corresponds to a **pod-base image ship**
(the release-versioning decision: image-only, per-ship). Write these for the owner — what changed for
them, not the commit log. See [docs/runbooks/release-notes.md](docs/runbooks/release-notes.md).

The format is loosely [Keep a Changelog](https://keepachangelog.com): newest first, grouped
**New / Fixed / Improved**. `scripts/cut-release.sh` reads the section for the version being cut.

## 0.1.0

The first named version. Everything before this was identified only by image digest; from here a pod
can tell you what it runs.

### New
- Pods now have a version you can name and quote, shown alongside the build id everywhere the pod's
  image appears.

### Fixed
- A pod that lost remote control after a failed T3 Code setup now heals itself on restart, instead of
  silently never greeting you again.
- A startup command whose folder was deleted now says exactly that, and how to fix it, instead of
  "keeps failing". Removing a startup command clears its error right away.

### Improved
- Update notes are written for people: internal changes and issue numbers are stripped, and changes
  are grouped into New / Fixed / Improved so you can tell a bug fix from a new feature at a glance.
