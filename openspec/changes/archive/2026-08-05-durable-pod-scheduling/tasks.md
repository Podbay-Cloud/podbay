# Tasks

Phased; applied on branch `propose/durable-pod-scheduling`. Per phase: code + spec (inline) + test.
All three land in the pod-base image, so nothing reaches real pods until an Incus image rebuild +
promote (the Ship phase — pending owner go).

## Phase A — Anti-`CronCreate` guidance ✅

- [x] A1 Added "Scheduling & startup must be DURABLE — `CronCreate` is NOT" to
      `packages/provider/pod-base/runtime-rules.md` (next to "What persists"): session-only, dies on
      restart/7-day expiry, never claim an armed job persists; use `podbay schedule` / `podbay startup`.
- [x] A2 Reaches every pod incl. BYO — it's in the runtime-rules layer (→ `~/.claude/CLAUDE.md` and
      `~/.codex/AGENTS.md`), not the BYO-skipped `_shared/universal` work-rules. `base-image.test.ts`
      31/31 green (assembly mechanism untouched). Real-pod grep deferred to Ship.
- [x] A3 No spec delta (rules-assembly already specced in `pod-boot`); logged in `0audit.md`.

## Phase B — Generalize the durable scheduler ✅

- [x] B1 `scheduler.ts`: `instructions?: string` on `OpsJob`; `defaultRunTrigger`/`defaultStallTrigger`
      rewritten env-neutral (carry `instructions`; defer reporting to the environment's rules).
- [x] B2 `scheduler.test.ts`: injected turn carries `instructions`, not `/api/runs`. **12/12 green.**
- [x] B3 `pod-base/podbay`: `cmd_schedule` (list/add/remove/enable/disable) → `~/work/.podbay/ops-jobs.json`
      via `jq`; case arm + help. Smoke-tested: emits schema-valid `OpsJob`.
- [x] B4 `podbay-cli-surfaces.test.ts`: add/list/disable/remove + error paths. **11/11 green.**
- [x] B5 Applied MODIFIED scheduler requirements to `openspec/specs/pod-agent/spec.md`
      (any-pod framing, `instructions`, env-neutral injection). `openspec validate pod-agent` valid.
- [x] B6 `morning-ops-robot` unaffected: its `.claude/rules/scheduled-runs.md` carries the `/api/runs`
      behavior; the trigger no longer hardcodes it, so its dashboard flow is preserved.

## Phase C — Agent-declared startup commands ✅

- [x] C1 `init.sh`: `run_startup_commands()` mirroring `start_dev_server` (pidfile+`kill -0` guard,
      `su - dev -c "nohup …"`, per-command `~/.podbay/startup/<slug>.{pid,log}`), reads
      `~/.podbay/startup.json`.
- [x] C2 Called at both `start_dev_server` sites: wake path (init.sh:871) + first-boot subshell (972).
- [x] C3 `pod-base/podbay`: `cmd_startup` (list/add/remove) → `~/.podbay/startup.json`; case arm + help.
- [x] C4 Applied ADDED "startup commands re-launched on every boot" requirement to
      `openspec/specs/pod-boot/spec.md`. `openspec validate pod-boot` valid.
- [x] C5 Verified `run_startup_commands` in a bash harness (stubbed `su`): only enabled/non-empty
      launch; second boot does NOT double-start (same pid); a dead process relaunches (new pid);
      `~/work` untouched. Real-pod `incus restart` verification deferred to Ship.

## Ship — pending owner go (outward-facing)

- [ ] S1 Rebuild + promote the pod-base image; pin the new `@sha256` per `docs/runbooks/deploy.md`.
- [ ] S2 Verify on a real updated pod (Claude + Codex; one BYO-repo pod): rule present in
      `~/.claude/CLAUDE.md`; `podbay schedule add …` then restart fires on time; `podbay startup add …`
      then `incus restart` relaunches.
- [ ] S3 `openspec archive durable-pod-scheduling --skip-specs` once shipped (specs already applied
      inline).
