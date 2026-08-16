# Vendored skill
source: anthropics/skills@webapp-testing
commit: 9d2f1ae187231d8199c64b5b762e1bdf2244733d
license: Apache-2.0
vendored: 2026-07-17
note: needs Chromium prebaked (PLAYWRIGHT_BROWSERS_PATH in pod-base)

PODBAY EDIT (2026-08-05): prepended a "browser is ALREADY installed at /opt/ms-playwright" section
to SKILL.md — vendored upstream assumes you install the browser; on a pod that DOWNLOAD is egress-
blocked and agents wrongly concluded "network wall / can't verify" (real report from a makore.app
pod). RE-PRESERVE this section on any future re-vendor.
