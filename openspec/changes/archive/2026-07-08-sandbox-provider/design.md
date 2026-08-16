## Context

The smoke test (Fly app `podbay-smoke`) validated the runtime model: a Fly Machine + a volume
gives persistent, suspend/resume-able pods, and the official Claude Code CLI runs unmodified
inside. This change turns those ad-hoc `fly` CLI steps into a programmatic, provider-agnostic
package. It consumes `ResolvedPod` from `@podbay/shared` and is consumed by `pod-agent`,
`pod-lifecycle`, and `launch-flow`. It deliberately excludes the PTY/terminal bridge and image
building.

## Goals / Non-Goals

**Goals:**
- One clean `SandboxProvider` interface in Podbay domain terms; Fly hidden behind it.
- Idempotent, isolated pod provisioning (machine + volume per pod) from a `ResolvedPod`.
- Sleep/wake mapped to Fly suspend/resume, with explicit `keepAwake`.
- First-boot config + setup injection (productized smoke-test entrypoint), no credentials.
- Unit-tested against a mocked Fly client; one gated live e2e.

**Non-Goals:**
- PTY/terminal bridge → `pod-agent`.
- Building images from Dockerfile/devcontainer → later image-build change; v0 boots a prebuilt
  base image + runtime injection.
- Full egress allowlist enforcement → v0 records policy, applies what Fly supports.
- Web UI, auth, billing, a second provider implementation.

## Decisions

- **Fly Machines REST API, not `flyctl` shelling.** Programmatic, testable, no subprocess
  parsing. Token held by the control plane. _Alternative:_ wrap `flyctl` (what the smoke test
  did) — fine for manual ops, poor as a library.
- **One Fly app holds all pod machines; one volume per pod.** Matches Fly's model and the
  per-project-pod topology decision. Pod id ↔ machine via machine `metadata`. _Alternative:_
  app-per-pod (heavier, hits app limits).
- **Provider owns the sleep decision, not Fly auto-stop.** The control plane calls `sleep` on an
  idle signal from `pod-agent`; `keepAwake` guards it. Cleaner than Fly's request-idle
  auto-suspend, which can't see Remote Control's outbound polling. Smoke test used auto-stop;
  we move to explicit control here.
- **Sleep = Fly `suspend` (RAM snapshot), wake = `start`.** Preserves the running session, as
  the smoke test showed. Fall back to stop/start where suspend is unavailable.
- **First-boot injection via a base image + init contract.** The pod base image ships a small
  init that, on first boot, writes the `.claude/` layer + permission preset to the volume and
  runs `setup` steps, then marks the volume seeded (so wake never re-runs). This is the
  smoke-test `entrypoint.sh` generalized; `pod-agent` will later own the process supervision.
- **Idempotency via metadata lookup before create.** `createPod` first queries machines by pod
  id tag; returns the existing pod if found.
- **Mocked Fly client for unit tests; live e2e gated by an env flag** (`PODBAY_LIVE_FLY=1`) so
  CI stays free and fast but the real path is exercised on demand.

## Risks / Trade-offs

- **Volume↔machine↔region coupling** (a Fly volume is bound to one machine and region) → pin a
  pod's region at create; instance replacement reuses the same volume; document that a pod does
  not migrate regions in v0.
- **Fly API rate limits / transient errors** → wrap calls with bounded retry + typed errors;
  surface `PodInfo.status` including transitional states.
- **Egress enforcement gap** (Fly lacks per-machine allowlist like Anthropic's proxy) → v0
  records the policy and applies coarse controls (e.g. no public networking for `none`); the
  allowlist proxy is a later hardening change. Called out as a known limitation.
- **Suspend not always available / cold wakes** → fall back to stop/start; expose wake latency
  in status so the UI can show progress.
- **Secret handling**: the Fly token is control-plane-only; a test must assert no credential is
  ever written into a pod.

## Migration Plan

New package; nothing to migrate. Deploy = create the Fly "pods" app and provision the control
plane's Fly token. Rollback = revert; no user surface depends on it yet. The smoke-test app is
untouched and remains the manual reference until `pod-agent` supersedes it.

## Open Questions

- Base image: reuse/evolve the smoke-test image, or build a dedicated `podbay-pod-base`? Leaning
  a dedicated slim base with Node + tmux + the CLIs + the init contract.
- Exec transport: Fly `machine exec` API vs a command through the pod-agent channel (once it
  exists). v0 uses Fly's exec; revisit when `pod-agent` lands.
- Snapshot semantics: Fly volume snapshots vs relying on suspend — v0 wires `snapshot` to Fly
  volume snapshots for backup, distinct from sleep.
