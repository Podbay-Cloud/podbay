# podbay-pod-base — the default image booted for pods until per-environment image
# building exists. Ships Node, tmux, the official Claude Code + Codex CLIs, and the
# first-boot init contract. NO credentials are baked in; users authenticate inside.
#
# Built from the repo ROOT context. The pod-agent bundle is compiled from source
# in a build stage (below) — hermetic; no locally-built artifact to drift.
#
# ⚠️ Deploy note: Fly worker hosts cache images BY TAG. Machines booted from the
# bare `:pod-base` tag can silently get a stale image. After every push, pin
# PODBAY_BASE_IMAGE to the new tag@digest on web + gateway (see docs/reference/deploy.md).

# ---- Stage 1: compile the pod-agent bundle from source ----
FROM node:22-slim AS agent-build
# node-pty (a pod-agent runtime dep) compiles from source during install.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@podbay/pod-agent..." \
    && pnpm --filter "@podbay/pod-agent^..." build \
    && pnpm -F @podbay/pod-agent build:bundle
# → /app/packages/pod-agent/dist-bundle/main.js (esbuild, @podbay/shared inlined)

# ---- Stage: prebuilt env templates (v0 of compute-strategy "prebuilt env
# images"). Scaffolding + dependency install happen at IMAGE BUILD, so a new
# pod copies a ready-to-run workspace instead of cloning/installing on a cold
# machine (which previously took the agent minutes of bootstrapping). ----
FROM node:22-slim AS env-templates
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
# nextjs-starter: create-next-app + install. onlyBuiltDependencies pre-approves
# the native builds (sharp/unrs-resolver) so pnpm v10 doesn't stall on them.
# (create-next-app validates cwd writability — run from inside the target dir)
WORKDIR /opt/env-templates
# next.config.ts ships with allowedDevOrigins so the dev server, reached through
# the Podbay preview proxy (a *.preview.podbay.cloud host, cross-origin to
# localhost:3000), doesn't have Next block its dev/HMR assets — which otherwise
# stops the client bundle from hydrating (page renders but nothing is interactive).
# Baked in so no pod has to rediscover this; the wildcard covers every pod host.
RUN npx --yes create-next-app@latest nextjs-starter \
      --typescript --tailwind --eslint --app --use-pnpm --yes \
    && cd nextjs-starter \
    && printf 'onlyBuiltDependencies:\n  - sharp\n  - unrs-resolver\n' > pnpm-workspace.yaml \
    && printf 'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  // Reached through the Podbay preview proxy (a *.preview.podbay.cloud host),\n  // cross-origin to localhost:3000. Next blocks cross-origin dev/HMR assets by\n  // default, which stops the client bundle from hydrating. Allow the preview host.\n  allowedDevOrigins: ["*.preview.podbay.cloud"],\n};\n\nexport default nextConfig;\n' > next.config.ts \
    && pnpm install \
    && CI=1 npx --yes shadcn@latest init -d -y \
    && CI=1 npx --yes shadcn@latest add button card input label badge table dialog select dropdown-menu -y -o \
    && find . -name globals.css -not -path '*/node_modules/*' -exec sed -i 's/--font-sans: var(--font-sans);/--font-sans: var(--font-geist-sans);/' {} + \
    && { pnpm build > /tmp/web-app-build.log 2>&1 || { cat /tmp/web-app-build.log; exit 1; }; } \
    && test -f components.json \
    && rm -rf .next /tmp/web-app-build.log \
    && chown -R 1000:1000 /opt/env-templates
# shadcn/ui: standardize the web-app engine on Tailwind + shadcn (init installs
# cva/clsx/tailwind-merge/lucide + radix; a base component set is preinstalled so
# a fresh pod has the design system ready). Non-interactive flags + a `pnpm build`
# fail the image build if shadcn ever breaks the scaffold. See docs/skills-management.md.

# doc-qa: same Next.js base + the Vercel AI SDK preinstalled, and a polished,
# already-working streaming chat overlaid on top — so a fresh pod opens a real
# app the user can talk to immediately, then customize with the agent (persona,
# knowledge, tools) rather than building the base UI from scratch.
# --src-dir is REQUIRED (not just --app): create-next-app's src-dir default is not
# stable across versions, and our chat overlay is copied to src/app below. Without
# it, the scaffold lands in a root app/ that Next prefers over src/app — silently
# shadowing the overlay and shipping the default page. The `test ! -d app` guard
# fails the build loudly if that ever regresses again.
RUN npx --yes create-next-app@latest doc-qa \
      --typescript --tailwind --eslint --app --src-dir --use-pnpm --yes \
    && cd doc-qa \
    && test ! -d app && test -d src/app \
    && printf 'onlyBuiltDependencies:\n  - sharp\n  - unrs-resolver\n' > pnpm-workspace.yaml \
    && printf 'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  // Reached through the Podbay preview proxy (a *.preview.podbay.cloud host),\n  // cross-origin to localhost:3000. Next blocks cross-origin dev/HMR assets by\n  // default, which stops the client bundle from hydrating. Allow the preview host.\n  allowedDevOrigins: ["*.preview.podbay.cloud"],\n};\n\nexport default nextConfig;\n' > next.config.ts \
    && pnpm add ai @ai-sdk/react @ai-sdk/anthropic pg \
    && pnpm add -D @types/pg
# Overlay the prebuilt chat (source lives in the repo, reviewed like any code) onto
# the scaffold's src/app, then compile it — a broken chat (or a missing /api/chat
# route) fails the image build instead of shipping. The chat also does doc-RAG
# (upload → Postgres FTS → grounded answers via src/app/rag.ts + /api/docs).
COPY environments/doc-qa/app/ /opt/env-templates/doc-qa/src/app/
RUN cd /opt/env-templates/doc-qa \
    && { pnpm build > /tmp/doc-qa-build.log 2>&1 || { cat /tmp/doc-qa-build.log; exit 1; }; } \
    && grep -q "/api/chat" /tmp/doc-qa-build.log \
    && test -f src/app/api/chat/route.ts && grep -q useChat src/app/page.tsx \
    && test -f src/app/api/docs/route.ts && test -f src/app/rag.ts \
    && rm -rf .next /tmp/doc-qa-build.log \
    && chown -R 1000:1000 /opt/env-templates
# first-10-customers (Playbook A): a PREBUILT, working app — a public landing at /
# and a password-gated CRM pipeline at /crm (leads + conversation log, optimistic
# client UI). Committed + build-verified in the repo (environments/first-10-customers/
# app), so a fresh pod opens a working app instead of self-scaffolding (which proved
# fragile: shadcn flag drift, a base-nova serif font bug, broken client/server
# boundaries). We just install deps + compile here.
COPY environments/first-10-customers/app /opt/env-templates/first-10-customers
RUN cd /opt/env-templates/first-10-customers \
    && pnpm install \
    && { pnpm build > /tmp/f10c-build.log 2>&1 || { cat /tmp/f10c-build.log; exit 1; }; } \
    && test -f src/app/crm/page.tsx && test -f src/proxy.ts \
    && rm -rf .next /tmp/f10c-build.log \
    && chown -R 1000:1000 /opt/env-templates

# morning-ops-robot (Playbook C): a PREBUILT ops dashboard — Jobs, Runs, Alerts,
# and the morning-digest timeline (environments/morning-ops-robot/app). Committed +
# build-verified in the repo; deps installed + compiled here so a fresh pod opens a
# working dashboard. The pod-agent scheduler runs the jobs (ops-jobs.json).
COPY environments/morning-ops-robot/app /opt/env-templates/morning-ops-robot
RUN cd /opt/env-templates/morning-ops-robot \
    && pnpm install \
    && { pnpm build > /tmp/mor-build.log 2>&1 || { cat /tmp/mor-build.log; exit 1; }; } \
    && test -f src/app/api/jobs/route.ts && test -f src/proxy.ts \
    && rm -rf .next /tmp/mor-build.log \
    && chown -R 1000:1000 /opt/env-templates

# ---- Stage: build the transparent egress SNI proxy (Go, static) ----
FROM golang:1.22-alpine AS egress-build
WORKDIR /src
COPY packages/provider/pod-base/egress-proxy/ .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /podbay-egress .

# ---- Stage 2: the pod runtime image ----
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive TERM=xterm-256color LANG=C.UTF-8 \
    DISABLE_AUTOUPDATER=1 \
    HOME=/home/dev

# Optional apt mirror. DEFAULT = Ubuntu's own mirrors, which is correct for every
# context this Dockerfile actually builds in: the local `make-payload --local-build`
# (a dev Mac) and the Fly image build (Fly builders). NEITHER runs inside Hetzner,
# and mirror.hetzner.com is NOT reachable from outside Hetzner's network — it Ign's
# every InRelease, leaving empty package lists so the next apt-get install dies with
# exit 100. (The BOX's Incus build does its own Hetzner pin in
# scripts/incus/provision-pod-base.sh, where it's correct.) This ARG only exists so
# a Dockerfile build that genuinely runs inside Hetzner can opt in:
#   --build-arg APT_MIRROR=http://mirror.hetzner.com/ubuntu/packages
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/*.list; do \
        [ -f "$f" ] && sed -i -E "s#https?://([a-z]{2}\.)?(archive|security)\.ubuntu\.com/ubuntu#${APT_MIRROR}#g" "$f" || true; \
      done; \
    fi

# build-essential + python3 so node-pty can compile if a linux prebuild isn't used.
# python-is-python3: Ubuntu ships python3 with NO `python` alias, so every skill/
# doc/script that calls `python` dies with "command not found" (exit 127). Hit live
# 2026-07-17: the webapp-testing skill ran `python verify_landing.py`, failed, and
# burned a retry to rediscover `python3`. The agent shouldn't pay that tax.
# The rest = what an agent reflexively reaches for (wget/zip/file/rsync/sqlite3)
# and what it needs to debug its own app (lsof/ss via iproute2/dig via dnsutils).
# Acquire::Retries survives a transient archive-fetch blip (exit 100) on the
# default Ubuntu mirror — the local build has no Hetzner mirror pin to fall back on.
RUN echo 'Acquire::Retries "4"; Acquire::http::Timeout "30";' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget git tmux vim nano jq unzip zip sudo openssh-client \
    ripgrep less python3 python3-pip python-is-python3 build-essential iptables \
    file rsync tree sqlite3 lsof iproute2 dnsutils \
    postgresql postgresql-contrib \
    && rm -rf /var/lib/apt/lists/* \
    && ls /usr/lib/postgresql/*/bin/initdb \
    && python --version   # fail the build if the `python` alias regresses

# PostgreSQL extensions from the official PGDG apt repo (latest for PG16): postgis
# (geo) + pgvector (embeddings). Ubuntu's universe ships these too but lags (pgvector
# 0.6 vs PGDG's current), and research/RAG envs want current. The PG16 SERVER above
# stays; these add its extension .so/.sql system-wide so a per-pod cluster picks them up.
RUN install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
         -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
         > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
         postgresql-16-postgis-3 postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI — the agent needs it to push specs/branches/PRs (the OpenSpec story
# in the playbooks). Installed from GitHub's own apt repo, pinned key.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* \
    && gh --version   # fail the build if gh didn't install

# Playwright + Chromium prebaked so the agent can click-test/verify UI (the
# webapp-testing skill) WITHOUT the runtime install rabbit-hole (a live pod once
# tried to sudo-apt libglib to debug a button). Browsers live in a world-readable
# path so the unprivileged `dev` user can launch them.
#
# PIN the Playwright version. Each Playwright release pins an EXACT Chromium build, and
# a Node script (web-fetch's chromium.launch, a user's @playwright/test, or podbay's own
# apps/web e2e) looks in $PLAYWRIGHT_BROWSERS_PATH for the revision ITS version wants —
# a datacenter pod cannot download a missing one. Left unpinned, `pip install playwright`
# grabbed latest (1.62 → chromium 1234) and drifted AHEAD of the repo's Node
# @playwright/test (1.61.1 → chromium 1228), so every Node browser launch failed on-pod.
# Keep this minor in lockstep with apps/web's @playwright/test so all three consumers
# (this Python install, Node web-fetch, podbay e2e) resolve the SAME baked Chromium.
#
# OWN it as uid 1000 (was a+rX = read-only). A BYO project that pins a DIFFERENT
# @playwright/test wants a different Chromium build, and `playwright install` writes into
# $PLAYWRIGHT_BROWSERS_PATH (=/opt) — read-only made that a silent no-op (exit 0, nothing
# downloaded → "Executable doesn't exist"). Writable, `playwright install` drops the missing
# revision ALONGSIDE the baked one: the matched version still launches instantly (no
# download), any other version installs once on demand. (makore pod report, 2026-08-16.)
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN pip3 install --break-system-packages --no-cache-dir 'playwright==1.61.0' \
    && python3 -m playwright install --with-deps chromium \
    && chown -R 1000:1000 /opt/ms-playwright && chmod -R u+rwX,go+rX /opt/ms-playwright \
    && rm -rf /var/lib/apt/lists/*

# Transparent egress allowlist proxy (enabled per-env by init.sh).
COPY --from=egress-build /podbay-egress /usr/local/bin/podbay-egress

# Node 22. NodeSource's setup can exit 0 without registering its repo (flaky
# network) → apt silently installs Ubuntu's npm-less nodejs. Verify npm exists so
# the build fails HERE with a clear message, not later at the CLI install.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/* \
    && command -v npm >/dev/null || { echo "FATAL: npm missing after node install"; exit 1; }

# Official CLIs (unmodified) + pnpm — baked in because `corepack enable` cannot
# run as the unprivileged dev user (no write access to the node bin dir), which
# silently killed env setup.
# Claude Code is PINNED (like openspec/pnpm) so "version X did Y" stays a
# sentence we can say; updates ride a reviewed image bump, not build timing.
# Bump the pin deliberately when cutting a new image (npm view … version).
RUN npm install -g @anthropic-ai/claude-code@2.1.251 @openai/codex@0.151.0 pnpm@10 \
    @fission-ai/openspec@1.6.0 \
    && rm -rf /home/dev/.npm /root/.npm \
    && openspec --version   # fail the build if the openspec bin isn't on PATH

# Codex STANDALONE build — the remote-control DAEMON (`codex remote-control start`,
# which makes a pod pairable from the Codex app) hard-fails without it; the npm codex
# above can only run the TUI + foreground RC. Staged on the rootfs here; init.sh seeds
# it into ~/.codex (the persistent volume, where the daemon looks) on a Codex pod's
# first boot. ~189MB. HOME/CODEX_HOME are pointed at the staging dir so the installer's
# PATH edits don't touch the real /home/dev. Pin to match the npm codex.
RUN mkdir -p /opt/podbay/codex-standalone \
    && CODEX_HOME=/opt/podbay/codex-standalone HOME=/opt/podbay/codex-standalone CODEX_VERSION=0.151.0 \
       sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' \
    && test -x /opt/podbay/codex-standalone/packages/standalone/current/codex \
    && rm -f /opt/podbay/codex-standalone/.bashrc /opt/podbay/codex-standalone/.profile \
    && chown -R 1000:1000 /opt/podbay/codex-standalone

# Non-root user; home is the persistent volume mount point
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -s /bin/bash dev \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev

# Prebuilt env templates (see stage above); init.sh copies into ~/work.
COPY --from=env-templates --chown=1000:1000 /opt/env-templates /opt/env-templates

COPY packages/provider/pod-base/init.sh /usr/local/bin/podbay-init
# Self-documenting runtime layer: the `podbay` CLI on PATH + the universal
# runtime-rules doc (init.sh copies it to ~/.claude/CLAUDE.md at first boot).
COPY packages/provider/pod-base/podbay /usr/local/bin/podbay
COPY packages/provider/pod-base/podbay-doctor /usr/local/bin/podbay-doctor
# Recovery command the PODBAY-AGENT-EXITED banner points at — relaunches a dead agent.
COPY packages/provider/pod-base/podbay-agent-restart /usr/local/bin/podbay-agent-restart
# Live config-refresh (docs/plans/live-config-refresh.md): the shared refresh ops + the on-demand
# entry the control plane execs to apply config to a RUNNING pod with no restart. refresh-common.sh
# is sourced (no +x needed); podbay-refresh is executable and on PATH.
COPY packages/provider/pod-base/refresh-common.sh /usr/local/bin/refresh-common.sh
COPY packages/provider/pod-base/podbay-refresh /usr/local/bin/podbay-refresh
COPY packages/provider/pod-base/runtime-rules.md /opt/podbay/runtime-rules.md
# Stop hook: the only part of `relentless` that does not depend on the agent remembering it.
COPY packages/provider/pod-base/hooks/relentless-stop.py /opt/podbay/hooks/relentless-stop.py
RUN chmod +x /opt/podbay/hooks/relentless-stop.py
RUN chmod +x /usr/local/bin/podbay-init /usr/local/bin/podbay /usr/local/bin/podbay-doctor /usr/local/bin/podbay-refresh /usr/local/bin/podbay-agent-restart

# The provider injects /etc/podbay/pod-spec.json and /etc/podbay/claude/* at create.
# pod-agent is the entrypoint: it runs podbay-init (first-boot seeding) then serves
# the terminal (PTY↔WebSocket + sidecar). node-pty (native) is installed here.
COPY --from=agent-build /app/packages/pod-agent/dist-bundle /opt/pod-agent
RUN cd /opt/pod-agent && npm install --omit=dev node-pty@^1.0.0 ws@^8.18.0 \
    && rm -rf /home/dev/.npm /root/.npm
# HOME=/home/dev during the npm installs above pollutes the image's home dir
# with npm caches — hundreds of MB that bloat every image pull and make the
# first-boot `chown -R /home/dev` crawl on volumeless machines.

CMD ["node", "/opt/pod-agent/main.js"]
