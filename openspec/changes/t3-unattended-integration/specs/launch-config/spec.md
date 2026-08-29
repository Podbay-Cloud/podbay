# launch-config — delta

## ADDED Requirements

### Requirement: The owner chooses the pod's providers (≥1) and its control mode at launch

The create-pod Settings step SHALL let the owner choose which **providers** (agent CLIs — Claude, Codex,
and later Cursor/Grok/OpenCode) run on the pod (at least one required, each otherwise optional) and the
**control mode** (Podbay, or **T3 Code** — one app driving all chosen providers, opt-in, off by default).
Choosing T3 SHALL provision the pod into unattended mode. The T3 choice SHALL explain, in owner-approved
copy, that T3 controls the chosen agents from one app, stays signed in for a year (one sign-in during
setup, no monthly reauthentication), is reversible, and SHALL link to t3.codes. The chosen providers SHALL
be brought to the mode's required auth state via the shared provider-auth flow (see dashboard spec) — only
the providers the owner selected, only the steps actually missing.

#### Scenario: Launching a pod under T3 with chosen providers

- **WHEN** the owner selects one or more providers and T3 Code control, then creates the pod
- **THEN** provisioning SHALL run the shared provider-auth flow for the chosen providers (Claude →
  setup-token OAuth so it boots on the 1-year token; Codex → device-auth if not already signed in),
  relocate any subscription cred, launch `t3 serve` on the token, and boot the pod already under T3

#### Scenario: T3 not selected

- **WHEN** the owner leaves the default (Claude Code or Codex)
- **THEN** the pod SHALL launch under normal Podbay control with the subscription login, unchanged
