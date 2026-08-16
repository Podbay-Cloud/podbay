## Context

Self-host pods are Docker containers launched by `LocalProvider`. Today `createPod` runs the
container with **no `--cpus`/`--memory`**, so pods are unbounded and their in-pod `/proc` reflects
the whole host — the cockpit's size picker (cloud tiers) and metrics are both wrong for OSS. The
`CreatePodInput` already carries a compute-tier concept for cloud sizing; we thread a plain
CPU/memory choice through the same path for local pods. `docker info` exposes the host's total CPUs
and memory; per-pod limits are readable from `docker inspect` (or tracked at launch), so "used vs
free" is computable without a scheduler.

## Goals / Non-Goals

**Goals:**
- Owner picks real CPU + memory for an OSS pod, defaulting to unlimited (today's behavior).
- `LocalProvider` enforces the choice via `docker run --cpus/--memory`.
- The picker shows host total, allocated-to-pods, and free, and warns (not blocks) past free.
- Per-container metrics become meaningful when a limit is set.

**Non-Goals:**
- No scheduler / no overcommit *prevention* — show + warn only; the owner may overcommit on purpose.
- Cloud size tiers unchanged. No disk quota enforcement (a disk hint may be shown but not enforced).

## Decisions

- **Default = unlimited.** Most self-hosters want "use what you need"; a limit is opt-in. This keeps
  behavior identical to today unless the owner sets one, so it's non-breaking.
- **CPU/memory as plain values**, not tiers, in OSS: `cpus` (fractional, e.g. `2` or `1.5`) and
  `memoryMb`. Thread them on `CreatePodInput` (reuse the existing resource field where possible) →
  `LocalProvider.createPod` → `--cpus`, `--memory <n>m`.
- **Host capacity from `docker info`** (`NCPU`, `MemTotal`); **allocated** = sum of running podbay
  pods' limits (label `podbay.managed=1`, read `HostConfig.NanoCpus`/`Memory` via `docker inspect`,
  or a stored value). `free = total - allocated`. Unlimited pods count as 0 allocated (honest: we
  can't attribute their actual use without sampling) — surfaced with a note.
- **Metrics**: the pod-agent MetricsSampler reads cgroup v2 (`memory.max`/`memory.current`,
  `cpu.max`) when `memory.max` is a real number; else falls back to `/proc/meminfo` (unchanged for
  Incus/LXCFS pods, which virtualize `/proc`). Only the *limited* case changes.
- **OSS-only UI branch**: the resource chooser renders under `editionOss()`; the cloud tier picker is
  the untouched default. Host capacity is fetched via a server action that calls
  `LocalProvider.hostCapacity()`.

## Risks / Trade-offs

- **Emulation / cgroup availability**: `--cpus`/`--memory` need cgroup support on the host; Docker
  Desktop provides it. If unavailable the flags are ignored by Docker (no crash) — acceptable.
- **Unlimited pods hide real usage** in the free/used view (counted as 0 allocated). Mitigation: a
  note that unlimited pods aren't reserved; a future pass could add live-usage sampling.
- **Over-tight limits can OOM-kill a pod's agent.** Mitigation: a sane minimum (e.g. ≥1 GB) and a
  warning; the pod-agent already has OOM recovery.
- **Remote (`ssh://`) hosts**: capacity + limits apply to the remote daemon's host, which is correct;
  `docker info`/`inspect` run against `DOCKER_HOST` already.
