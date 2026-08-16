## Why

In the self-host (OSS) edition, pods run on the owner's *own* hardware, but the launch flow still
shows the cloud "machine size / tier" picker — sizes that map to cloud billing tiers and mean
nothing on a laptop or a VPS. Worse, self-host pods currently run with **no resource limits**, so a
single pod can starve the host, and the cockpit metrics read the whole Docker VM (`/proc`) instead
of the container, so numbers are meaningless. The owner has no way to say "give this pod 2 CPUs and
4 GB," and no view of what's already used vs. free on their machine.

## What Changes

- In the OSS edition, replace the cloud size/tier picker with a **real-resource chooser**: pick CPU
  and memory (a number/slider) for the new pod, defaulting to **no explicit limit** (the pod uses
  what it needs, as today).
- `LocalProvider` applies the choice as `docker run --cpus <n> --memory <n>`.
- Show **host capacity awareness**: the Docker host's total CPU/RAM (from `docker info`), the amount
  already allocated to running podbay pods, and what's free — so the picker can cap/warn at free
  capacity and the owner can see what's left.
- Because limits make cgroup accounting meaningful, the pod's metrics become **per-container** rather
  than VM-wide (a dependency to note; the sampler prefers cgroup readings when a limit is set).
- The cloud size picker is unchanged; this is OSS/local-provider only.

Out of scope: any hard multi-pod scheduler or overcommit *enforcement* — this only shows capacity and
warns; the owner may still overcommit deliberately.

## Capabilities

### New Capabilities

(none — extends the existing `self-host` capability)

### Modified Capabilities

- `self-host`: add a requirement that OSS pod creation chooses real host resources (CPU/memory) that
  the local provider enforces via container limits, with host-capacity awareness in the picker.

## Impact

- **UI**: `apps/web/components/launch-configure.tsx`, `apps/web/app/dashboard/pods/new/*` — swap the
  size tier picker for the resource chooser in OSS; a host-capacity read for the free/used display.
- **Provider**: `packages/provider/src/local/provider.ts` — accept per-pod CPU/memory, pass
  `--cpus`/`--memory` to `docker run`; add a `hostCapacity()` query (`docker info` + per-pod limits).
- **Control plane**: thread the chosen resources from launch → `CreatePodInput` → the provider
  (the resource fields already exist on the input for tiers; reuse or extend).
- **Metrics**: `packages/pod-agent` MetricsSampler — read cgroup `memory.current`/`.max` (and CPU)
  when a limit is present, falling back to `/proc` (so Incus/LXCFS pods are unaffected).
- **Spec**: `openspec/specs/self-host/spec.md`.
