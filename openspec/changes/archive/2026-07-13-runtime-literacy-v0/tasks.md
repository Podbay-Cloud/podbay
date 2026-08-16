## 1. Provider: preview URL in the pod-spec

- [x] 1.1 `fly/init.ts`: `slug` + `previewUrl` in `PodSpec` from slug + `PODBAY_PREVIEW_BASE`
- [x] 1.2 `fly/provider.ts` + `SandboxProvider`: `podAddress(id, port)` → `http://[ip]:<port>`

## 2. In-pod self-documenting layer

- [x] 2.1 `packages/provider/pod-base/podbay` — CLI (`info`, `preview [port]`) reading the pod-spec
- [x] 2.2 `packages/provider/pod-base/runtime-rules.md` — universal rules
- [x] 2.3 Dockerfile bakes both; `init.sh` copies rules → `~/.claude/CLAUDE.md` (guarded)
- [x] 2.4 base-image test: CLI + rules present; CLI prints URL from a pod-spec fixture

## 3. DB + control-plane: previewPublic

- [x] 3.1 `db/schema.ts`: `previewPublic` on `pods`; migration `0004_stale_ogun.sql`
- [x] 3.2 control-plane `types.ts` + `drizzle-store.ts`: carry the flag on `PodRecord`
- [x] 3.3 `service.ts`: `setPreviewPublic(ownerId, id, public)` + unscoped `lookupForPreview(slug)`

## 4. Gateway: preview proxy

- [x] 4.1 `config.ts` + `main.ts`: `previewBase`, `resolvePreviewOrigin`, public-flag lookup
- [x] 4.2 `server.ts`: Host dispatch — `<slug>.<base>` → resolve → wake → proxy HTTP + WS to
  `http://[pod-ip]:3000`; terminal WS (`/pods/*`) + `/healthz` unchanged
- [x] 4.3 Auth: owner-authed via session; skip when public
- [x] 4.4 gateway tests: Host routing; owner-vs-public (401/403/200); public anon; wake-on-request

## 5. Web: make-public toggle

- [x] 5.1 Dashboard Preview link + public/private toggle (server action → `setPreviewPublic`)

## 6. Verify + operator (done live 2026-07-12)

- [~] 6.1 Preview auth covered by gateway unit tests (owner 200 / anon 401 / non-owner 403 /
  public 200 / 404 / wake-on-request). Full app-level preview e2e **deferred** as a follow-up.
- [x] 6.2 Live-verified: `podbay info` shows the URL; owner/incognito/public toggle all worked;
  `~/.claude/CLAUDE.md` present (see the session verification on a real pod)
- [x] 6.3 Operator done: Cloudflare `*.preview.podbay.cloud` + `fly certs add` wildcard (Issued);
  `PODBAY_PREVIEW_BASE=preview.podbay.cloud` set on web + gateway; pod-base rebuilt + digest pinned
- [x] 6.4 Docs updated: `docs/roadmap.md` (Preview URLs v0) + `docs/agent-runtime-literacy.md` status
