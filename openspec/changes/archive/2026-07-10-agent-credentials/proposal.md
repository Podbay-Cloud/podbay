## Why

Every pod currently requires a fresh CLI login, even though the user already authenticated in
another pod — friction that defeats "one-click, ready-to-run". The environment config already
declares which agent a pod runs (`agents: [claude-code]`); a pod for that env should boot with
the CLI **preset and authenticated** using the user's own subscription credentials, making login
a once-per-account event, not once-per-pod.

## What Changes

- **Credential vault**: new `user_agent_credentials` table — `(userId, agent)` → credential blob
  encrypted at rest (AES-256-GCM, key from a new `PODBAY_CRED_KEY` server secret), `updatedAt`.
- **Capture**: `pod-agent` health gains `authed` + a credentials-file hash. When the gateway
  sees the unauthenticated→authenticated transition (or a changed hash) on a session tick, the
  control plane captures `~/.claude/.credentials.json` (Claude) / `~/.codex/auth.json` (Codex)
  via provider exec and stores it encrypted. Refreshed tokens propagate the same way.
- **Injection**: at pod create, if the user has stored credentials for the env's agent, the
  provider injects them as first-boot files (mode 0600, owned by `dev`); `init.sh` places them
  before the agent boots, so the boot command finds credentials and starts the CLI directly.
- **User control**: dashboard shows "Saved logins" per agent with a **Forget** action (deletes
  the vault row; new pods require login again). Vault rows are purged with the account.
- **Boundaries kept**: the environment FORMAT still never carries credentials (existing ToS
  guard unchanged — this is per-USER state held by the platform, not env content); credentials
  never appear in logs (redaction) nor in the marketplace surface.

## Security posture (honest)

- The platform now holds user OAuth tokens: encrypted at rest, decrypted only at pod create.
- Injected files are visible in Fly machine config to our org — the same trust domain as the
  database that stores them. Hardening follow-up (documented, not in scope): one-time fetch
  token so credentials never sit in machine config; egress allowlist remains the top backstop
  against in-pod exfiltration (separate change).
- Known risk: multiple concurrent pods share a refresh token; capture-on-change keeps the vault
  current, and a rotation-invalidates-copies policy change by the vendor would degrade to
  re-login (never worse than today).

## Capabilities

### New: `agent-credentials`

Authenticate an agent CLI once; every later pod for an env declaring that agent boots already
authenticated, with a per-agent "Forget" control.

## Impact

- `@podbay/db` (table + migration), `@podbay/shared` (crypto util), `packages/pod-agent`
  (health authed/hash), `packages/provider` (inject files, exec capture), `packages/gateway`
  (transition detection hook), `apps/web` (saved-logins UI), `init.sh` (placement),
  new `PODBAY_CRED_KEY` secret on web + gateway; pod-base image rebuild + digest re-pin.
