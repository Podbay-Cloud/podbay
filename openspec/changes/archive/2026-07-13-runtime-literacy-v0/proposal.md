## Why

A pod agent spent ~12 minutes fighting a `next build` crash and still couldn't hand the user a
working URL for what it built. Root cause: the agent has **no model of where it runs or how to
ship**, and there is **no mechanism to expose a running app**. Today's env `.claude/CLAUDE.md`
even claims *"a preview URL is available"* — a lie, because previews don't exist. This is the gap
between "the product can make things" and "the product can deliver them," and the foundation the
proactive-agent vision stands on. Plan of record: `docs/agent-runtime-literacy.md`.

## Decisions

- Literacy = **knowledge** (rules) + **capability** (tools); prefer **self-documenting capability**
  (a tool that prints live truth can't drift the way a rule can).
- The **runtime layer is universal, authored once by podbay**, injected into every pod (NOT
  per-env — re-deriving it per env is how the stale-URL lie happened).
- Capability surface = one in-pod **`podbay` CLI** (read-only, unauthenticated in v0). MCP later.
- Preview delivery = **auto-forwarded, always-on** for port 3000 → `<slug>.preview.podbay.cloud`.
- Preview access = **owner-authed by default + a per-pod "make public" toggle**.

## What Changes

- **`podbay` CLI** baked into the image on PATH, reads only `/etc/podbay/pod-spec.json`:
  `podbay info` (slug, env, preview URL, what persists, egress policy, agent) and
  `podbay preview [port]` (preview URL for a port; owner-only note).
- **Universal runtime rules**: a podbay-authored `runtime-rules.md` baked in; `init.sh` copies it
  to `~/.claude/CLAUDE.md` (guarded), short, pointing at the CLI for live facts.
- **Provider**: compute `previewUrl` from slug + `PODBAY_PREVIEW_BASE` into the pod-spec; add a
  pod-IP:port resolver.
- **Gateway**: Host-dispatched preview proxy — `<slug>.preview.podbay.cloud` → resolve slug →
  proxy HTTP + WS to `http://[pod-ip]:3000` over 6PN, wake-on-request; owner-authed unless the pod
  is public. Coexists with the terminal WS (`/pods/*`) split by Host.
- **DB + control-plane**: `previewPublic` flag on pods; owner-scoped `setPreviewPublic`.
- **Web**: a dashboard "make public" toggle (server action).

Out of scope (later stages, see the plan): remote/user-domain deploy, CI/CD, secrets tooling,
arbitrary-port auto-forward, the authenticated laptop CLI, the MCP wrapper.

## Impact

- New: `packages/provider/pod-base/podbay` (CLI), `.../runtime-rules.md`,
  `openspec/changes/runtime-literacy-v0`.
- Changed: pod-base `Dockerfile` + `init.sh`; provider `fly/init.ts` (previewUrl) + `fly/provider.ts`
  (pod-IP:port resolver); gateway `server.ts` + `main.ts` + `config.ts`; db `schema.ts` + migration;
  control-plane `service.ts` + `drizzle-store.ts` + `types.ts`; `apps/web` dashboard + server action.
- Operator (Cloudflare): `A/AAAA *.preview.podbay.cloud → gateway`, `fly certs add` wildcard, set
  `PODBAY_PREVIEW_BASE`.
