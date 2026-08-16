# Self-host app image — ONE image that runs both compose services:
#   web    the dashboard (Next standalone server)
#   serve  the daemon (terminal gateway + provisioner), packages/selfhost/podbay.mjs serve
#
# Built from the repo ROOT context (compose sets context: ..). V1 is a full-workspace
# image — simple and correct; the slim standalone-only pattern of apps/web/Dockerfile
# (Fly) can shrink it later.
FROM node:22-slim
RUN npm install -g pnpm@10
# node-pty (via @podbay/pod-agent in the workspace install) compiles native — toolchain needed.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
# Docker CLI (static, client only): LocalProvider drives pods by spawning `docker` against the
# HOST's /var/run/docker.sock, which compose mounts into web + serve. No daemon in this image.
ARG TARGETARCH
ARG DOCKER_VERSION=27.5.1
RUN arch=$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64) \
    && curl -fsSL "https://download.docker.com/linux/static/stable/${arch}/docker-${DOCKER_VERSION}.tgz" \
    | tar -xz --strip-components=1 -C /usr/local/bin docker/docker

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Dummy DB env: every page is force-dynamic so `next build` never queries the DB, but the env
# must exist for the pg code path to construct. Scoped to this RUN only — compose provides the
# real values at runtime (server components read them per-request, nothing is baked).
RUN PODBAY_EDITION=oss PODBAY_DB=pg DATABASE_URL=postgres://build@127.0.0.1:5/build \
    pnpm -r build
# The Next standalone server serves static/public only from INSIDE its own tree.
RUN cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
    && cp -r apps/web/public apps/web/.next/standalone/apps/web/public

ENV NODE_ENV=production
ENTRYPOINT ["sh", "/app/selfhost/start.sh"]
