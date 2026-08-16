## Why

The strongest prosumer tiles ([environments-shortlist.md](../../../docs/environments-shortlist.md))
are **blocked on secret input**: `telegram-bot` needs a BotFather token, `ai-chat` needs an LLM
API key, `saas-app` needs a Stripe test key. Today an env can declare **non-secret** config
(`env:` in `podbay.yaml`, committed) but there is **no way for a user to supply a secret** (their
own token/key) that reaches the app the agent builds. `pod-secrets` is the platform gate that
unblocks the marketplace. Sequence + rationale: [audience-reposition-plan.md](../../../docs/audience-reposition-plan.md),
[pre-alpha-plan.md](../../../docs/pre-alpha-plan.md).

Distinct from the existing **agent-credential vault** (`user_agent_credentials`): that stores the
*CLI's own login* (Claude/Codex auth), captured automatically, reused across a user's pods.
`pod-secrets` stores the *user's app secrets* (BotFather token, API keys), entered by the user,
scoped to a pod. Both reuse the same crypto.

## Decisions

- **Scope = per-pod.** A BotFather token belongs to one bot. (Per-user *reusable* secrets — e.g. an
  LLM key used across pods — are a deferred follow-up.)
- **Encrypted at rest, reusing the vault crypto.** AES-256-GCM via `@podbay/shared/crypto`
  (`encryptSecret`/`decryptSecret`, `PODBAY_CRED_KEY`). New `pod_secrets` table `(podId, key, blob,
  updatedAt)`, PK `(podId, key)`. A `SecretVault` + `DrizzleSecretStore` mirroring `CredentialVault`
  — the store only ever sees ciphertext.
- **The env declares which secrets it needs.** Add `secrets` to the `podbay.yaml` schema: a list of
  `{ key, description?, required? }`. Values are **never** in the yaml; the env declares the *shape*,
  the user supplies the *values* per pod.
- **Write-only UI.** A per-pod secrets form (pod card menu / pod view) prompted by the env's declared
  secrets. Shows **set / not-set** only — the stored value is **never returned to the browser**
  (password-field semantics). Owner-scoped `setSecret` / `clearSecret` server actions.
- **Injection = shell-exported env vars, re-injected each boot from the DB (source of truth).**
  `buildInitFiles` writes the decrypted `KEY=value` set to a Fly machine file `/etc/podbay/secrets.env`
  (base64, like credential blobs — **never** in `pod-spec.json`); `init.sh` installs it `0600`
  dev-owned and sources it from `~/.bashrc` (`set -a; . /etc/podbay/secrets.env; set +a`) so the
  values are real `process.env` vars for anything the agent launches (bot, `next dev`, script).
  Editing a secret takes effect on the next wake. **Not** written to `~/work/.env` — keeping secrets
  out of the workspace avoids the git-leak footgun (an agent running `git add -A && push` would
  otherwise ship the token to the user's repo) and any dotenv clobber/merge. The runtime rules tell
  the agent the secrets are env vars and must never be written to a committable file.
- **Values never leave the pod in plaintext.** Never logged, never in `pod-spec.json` beyond the
  injected file, never returned by any API. Leak-check applies.

## Accepted risk (alpha)

A prompt-injected agent inside the pod **can read the app secrets** (it needs them to run the app)
and could exfiltrate them. This is exactly what **egress enforcement** ([egress-plan.md](../../../docs/egress-plan.md))
mitigates — currently shipped **dormant** (the fresh-inbound blocker). Accepted for alpha; secrets +
egress un-dormanting should land together before public launch. Also: Fly machine `files` store the
blob in the machine config (same exposure as agent credentials today) — accepted; a fetch-on-boot
path is a deferred hardening.

## What Changes

- **shared**: `secrets` in the env `podbay.yaml` schema + resolve.
- **db**: `pod_secrets` table + migration (direct-SQL to Neon, as with prior migrations).
- **control-plane**: `DrizzleSecretStore` + `SecretVault`; `PodService` owner-scoped
  `setSecret` / `clearSecret` / `listSecretKeys` (keys + set/not-set, never values); wire secret
  retrieval into pod launch/boot.
- **provider**: `buildInitFiles` writes `/etc/podbay/secrets.env`; `init.sh` installs + sources it.
- **web**: a secrets panel on the pod (prompted by the env's declared secrets) + server actions.
- **env**: `telegram-bot` / `ai-chat` declare their `secrets` (built in their own change, after this).

## Deferred

Per-user reusable secrets; fetch-on-boot injection (avoid Fly-config storage); secret rotation/audit;
per-env default/demo keys.
