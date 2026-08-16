# podbay-gateway — the authenticated terminal WebSocket proxy. Built from the repo
# ROOT context (workspace deps). The build stage pulls in @podbay/pod-agent (a
# gateway devDep for integration tests) whose node-pty compiles from source, so
# the build stage carries a compile toolchain. The runner stage stays slim; the
# gateway itself never loads node-pty at runtime.
FROM node:22-slim AS base
RUN npm install -g pnpm@10
WORKDIR /app

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile --filter "@podbay/gateway..."
RUN pnpm -r --filter "@podbay/gateway..." build

FROM base AS runner
ENV NODE_ENV=production \
    PODBAY_GATEWAY_HOST=:: \
    PODBAY_GATEWAY_PORT=8090
# WireGuard to the Incus box (infra-strategy.md M1). Tools only — the tunnel
# comes up in wg-up.sh IF PODBAY_WG_CONF is set; Fly-only deploys skip it.
RUN apt-get update && apt-get install -y --no-install-recommends wireguard-tools iproute2 \
    && rm -rf /var/lib/apt/lists/*
# Plain Node service (not bundled): bring the built workspace + linked node_modules.
COPY --from=build /app /app
COPY packages/gateway/wg-up.sh /usr/local/bin/wg-up.sh
RUN chmod +x /usr/local/bin/wg-up.sh
EXPOSE 8090
CMD ["/usr/local/bin/wg-up.sh"]
