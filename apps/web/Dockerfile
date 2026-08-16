# apps/web image. Because apps/web now depends on the workspace package @podbay/db,
# this MUST be built with the repo ROOT as the build context:
#
#   fly deploy --config apps/web/fly.toml --dockerfile apps/web/Dockerfile .
#
# (Unverified until the auth live path is wired — needs a Neon DB + GitHub OAuth app.)
FROM node:22-slim AS base
RUN npm install -g pnpm@10
WORKDIR /app

FROM base AS build
# web depends on @podbay/pod-agent + @podbay/gateway (for the e2e stack), so the
# install closure includes node-pty, which compiles from source — carry a native
# toolchain in the build stage. The slim runner stage below never loads node-pty.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# Copy the whole workspace (.dockerignore excludes node_modules/.next/dist) so the
# frozen lockfile resolves. Install @podbay/web and every workspace dep it needs.
COPY . .
RUN pnpm install --frozen-lockfile --filter @podbay/web...
# NEXT_PUBLIC_* is inlined into the CLIENT bundle at build time, so a runtime Fly
# secret is invisible to the browser. Without these ARGs the PostHog token builds as
# `undefined`, the client init silently skips — and its own warning is suppressed
# because NODE_ENV is production — so analytics quietly does nothing in prod while
# looking configured. Passed by scripts/deploy-app.sh from the deployer's env.
#
# (Contrast NEXT_PUBLIC_GATEWAY_URL, which works from a runtime secret only because
# a SERVER component reads it and passes it down as a prop.)
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ENV NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
# Build @podbay/web and every workspace dependency it needs, in topological order.
RUN pnpm -r --filter "@podbay/web..." build

FROM base AS runner
ENV NODE_ENV=production \
    WAITLIST_DIR=/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PODBAY_ENVIRONMENTS_ROOT=/app/environments
# WireGuard to the Incus box (infra-strategy.md M1): the web app runs the
# provisioner + reconcile, so it needs the tunnel. Tools only — wg0 comes up in
# wg-up.sh IF PODBAY_WG_CONF is set; Fly-only deploys skip it.
RUN apt-get update && apt-get install -y --no-install-recommends wireguard-tools iproute2 \
    && rm -rf /var/lib/apt/lists/*
# Next standalone output is rooted at the repo (outputFileTracingRoot), so it
# contains apps/web/server.js + traced node_modules + packages.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# Next standalone does NOT include public/ — copy it so /podbay-mark.svg etc. serve.
COPY --from=build /app/apps/web/public ./apps/web/public
# The environment catalog is read from disk at runtime.
COPY --from=build /app/environments ./environments
COPY apps/web/wg-up.sh /usr/local/bin/wg-up.sh
RUN mkdir -p /data && chmod +x /usr/local/bin/wg-up.sh
EXPOSE 3000
CMD ["/usr/local/bin/wg-up.sh"]
