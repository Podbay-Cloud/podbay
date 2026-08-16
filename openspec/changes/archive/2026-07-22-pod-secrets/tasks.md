## 1. Env spec: declared secrets

- [x] 1.1 `packages/shared/src/schema.ts`: add `secrets?: [{ key: string; description?: string;
  required?: boolean }]` to the env schema (UPPER_SNAKE key validation); tests
- [x] 1.2 `resolve.ts`: carry the declared secrets onto `ResolvedPod`

## 2. DB + crypto store

- [x] 2.1 `packages/db/src/schema.ts`: `pod_secrets` `(podId → pods.id cascade, key, blob, updatedAt)`,
  PK `(podId, key)`; migration `drizzle/0006_magenta_legion.sql` generated + **applied to prod Neon**
  (idempotent direct-SQL; verified table/PK/cascade FK live).
- [x] 2.2 `packages/control-plane`: `DrizzleSecretStore` (get/upsert/delete/listKeys/all) + `SecretVault`
  (encrypt in / decrypt out) mirroring `CredentialVault`; unit tests

## 3. Control-plane service

- [x] 3.1 `PodService.setSecret` / `clearSecret` / `listSecrets` → declared × set/not-set (never
  values); owner-scoped
- [x] 3.2 Retrieve-for-injection: `pushSecrets` decrypts the pod's set secrets (system op)
- [x] 3.3 Wire secrets into launch/boot: `buildInitFiles` seam + re-inject on wake (reconcile)

## 4. Provider injection

- [x] 4.1 `fly/init.ts` `buildInitFiles`: write set secrets to `/etc/podbay/secrets.env`
  (base64 machine file, NOT in pod-spec.json) + `injectSecrets` exec path for live pods
- [x] 4.2 `pod-base/init.sh`: install `/etc/podbay/secrets.env` `0600` owned by `dev`; source it
  from `~/.bashrc` (`set -a; . …; set +a`); re-run each boot; NOT in `~/work`. Runtime-rules line:
  secrets are env vars, never commit them.
- [x] 4.3 base-image test: injection wiring; no plaintext in the machine file / exec argv

## 5. Web UI

- [x] 5.1 Secrets panel (card ⋯ menu), prompted by the env's declared secrets; write-only
- [x] 5.2 `apps/web/lib/actions.ts`: `listPodSecrets` / `setPodSecret` / `clearPodSecret` server
  actions (owner-scoped, catch→log→typed error)

## 6. Verify

- [x] 6.1 Unit: SecretVault round-trip; owner-scoping; UI never returns values
- [x] 6.2 Injection path exercised via MockProvider (set-while-running push + re-inject on wake).
  Playwright UI e2e deferred until a secret-declaring env ships (telegram-bot/ai-chat).
- [ ] 6.3 Live: launch a secret-declaring env → set a secret → pod boots with the env var present,
  `0600` owned by `dev`, absent when unset
- [x] 6.4 Leak-check the diff (clean); accepted-risk pairing (prompt-injected agent can read the
  env vars → egress allowlist is the mitigation, currently dormant) noted in proposal + commit
