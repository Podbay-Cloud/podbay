## Why

A `ResolvedPod` (from `environment-spec`) describes *what* a pod should be; nothing yet turns
it into a *running* container with a persistent filesystem. Every user-facing capability —
launch flow, terminal, lifecycle, preview URLs — needs one abstraction that provisions and
controls pods on cloud infrastructure. The smoke test proved the Fly Machines + volumes model
end-to-end (persistent sessions surviving disconnect and full redeploy, suspend/resume). This
change extracts that into a first-class, provider-agnostic `SandboxProvider` interface with a
Fly implementation, so the rest of the MVP builds against a stable contract and a second
provider (Cloudflare/Sprites) is later work, not a rewrite.

## What Changes

- New package `packages/provider`: a **`SandboxProvider` interface** (create, get, list, exec,
  sleep, wake, setKeepAwake, snapshot, destroy, endpoint) and its **`ResolvedPod`-driven**
  input contract, consuming `@podbay/shared`.
- A **`FlyProvider`** implementation over the Fly Machines REST API: one machine + one volume
  per pod, deterministic/idempotent create, suspend/resume as sleep/wake, teardown removing
  machine and volume.
- **Config + setup injection at first boot**: seed the environment's `.claude/` layer and the
  guarded-open permission preset into the pod, run `setup` steps once, before the agent starts
  — the productized version of the smoke-test `entrypoint.sh`/`session` logic.
- **Explicit sleep control**: the provider owns sleep/wake (called by the control plane on an
  idle signal), with a `keepAwake` flag so a pod stays up during an active Remote Control
  session (per architecture-topology.md).
- Tests: unit tests against a mocked Fly client for every interface method, plus one gated
  live end-to-end test (create → exec → sleep → wake → destroy) against real Fly.

ToS-sensitive surface: the provider never injects model credentials; per-user CLI auth still
happens inside the pod. The provider only seeds non-secret config and runs setup steps.

## Capabilities

### New Capabilities
- `sandbox-provider`: the provider-agnostic pod lifecycle contract (provision, exec, sleep/wake,
  snapshot, destroy, endpoint, isolation, config injection) and its Fly implementation.

### Modified Capabilities
<!-- None. Consumes environment-spec; does not change it. -->

## Impact

- New package `packages/provider` (`@podbay/provider`), depending on `@podbay/shared`.
- Introduces a Fly "pods" app + a Fly API token as control-plane configuration (secret held by
  the control plane, never in a pod).
- Establishes the contract consumed next by `pod-agent`, `pod-lifecycle`, and `launch-flow`.
- Non-goals (explicit): the in-pod PTY bridge / terminal (that is `pod-agent`); building images
  from a Dockerfile/devcontainer (a later image-build change — v0 boots a prebuilt base image
  and injects config/setup at runtime, like the smoke test); full egress-allowlist enforcement
  (v0 records the policy and applies what Fly supports; the allowlist proxy is later hardening);
  web UI, auth, billing, and any second provider implementation.
