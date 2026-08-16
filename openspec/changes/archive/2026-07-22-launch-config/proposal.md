## Why

Launching is one-click with **no inputs**: `launchPod(ownerId, env)` creates a pod immediately
with no name and no secrets. For envs that declare **required** secrets (`ai-chat` needs
`ANTHROPIC_API_KEY`, `telegram-bot` needs a BotFather token) this means the pod boots
**without** the value, the app errors, and the only recovery is adding the secret to a
*running* pod — which is confusing and, until the shell-propagation fix, silently broken. It
also means every pod is named by an opaque slug with no way to set a name up front.

`launch-config` turns launch into a short **configuration step**: name the pod, fill in the
env's required secrets, and (extensibly) pick options — then launch. Required secrets are
injected from **first boot**, so the app works on the first try. This is the launch half of
`env-listings` and the direct fix for the class of problem hit on `ancient-coyote-c93d`.

## Decisions

- **`launchPod` gains an options arg**: `launchPod(ownerId, env, { name?, secrets? })`. Both
  optional and backward-compatible (no-arg launch still works).
- **Secrets are validated against the env's declared secrets** (`resolved.secrets`): only
  declared keys are accepted; **required** secrets missing/blank ⇒ the launch is rejected with
  a clear error (the UI blocks the button, this is the server-side guard).
- **Secrets are persisted AND injected at boot.** Provided values are stored in the
  `SecretVault` under the new pod id (so they survive wake re-injection) **and** passed to
  `createPod` as `secrets`, which `buildInitFiles` already writes to `/etc/podbay/secrets.env`
  at boot. The app has them from the first process — no post-launch scramble.
- **Name is set on the record** at creation (reuses the existing `name` field / validation:
  trimmed, ≤60 chars, empty ⇒ null ⇒ slug).
- **Web launch becomes a dialog.** The env tile opens a launch dialog: a name field, one field
  per declared secret (required ones marked, password-semantics — write-only, never
  pre-filled), and a Launch button disabled until required secrets are filled. Envs with no
  declared secrets get a minimal dialog (just an optional name) — still one confirm click.
- **Values never leave the pod/DB in plaintext**: never logged, never echoed back. Same
  leak-check discipline as `pod-secrets`.

## What Changes

- **control-plane**: `launchPod` accepts `{ name?, secrets? }`; validates against declared
  secrets; stores provided secrets in the vault for the new pod; passes them to `createPod`;
  sets the name. New `ControlError("missing required secret …", "invalid")`.
- **web**: launch dialog component (name + declared-secret fields), replacing the immediate
  one-click; `launchPod` server action gains `{ name?, secrets? }`; the gallery opens the
  dialog.
- **tests**: control-plane (name set; secrets stored + injected via provider; required-secret
  rejection; only-declared-keys); web action test; e2e for the dialog → launch path.

## Deferred

- **Machine size / region / lifecycle pickers** and **env-declared options** — these need the
  env schema to declare options and the provider to vary guest size; folded into `env-listings`
  / `pod-lifecycle`. `launch-config` leaves the dialog **extensible** (an options section) but
  ships name + secrets.
- Per-user reusable secrets (a saved key auto-filling the field) — deferred with the
  per-user-secrets follow-up.
