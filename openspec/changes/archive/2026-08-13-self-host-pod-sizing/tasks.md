## 1. Provider: resource limits + host capacity

- [x] 1.1 `LocalProvider.createPod` accepts per-pod `cpus?` / `memoryMb?` and appends `--cpus <n>` /
      `--memory <n>m` to `docker run` when set (omit when unset → unlimited, as today).
- [x] 1.2 Add `LocalProvider.hostCapacity()`: read host total CPU/memory from `docker info`
      (`NCPU`, `MemTotal`) and sum running `podbay.managed=1` pods' limits (from `docker inspect`
      `HostConfig.NanoCpus`/`Memory`) → `{ cpus, memoryMb, allocatedCpus, allocatedMemoryMb }`.
- [x] 1.3 Unit-test the arg construction (limits present/absent) and the capacity math (allocated =
      sum of limited pods; unlimited pods contribute 0) with a faked `docker` runner.

## 2. Control plane / input plumbing

- [x] 2.1 Thread `cpus`/`memoryMb` from launch through `CreatePodInput` to the provider (reuse the
      existing resource/tier field where it fits, else add optional fields).
- [x] 2.2 A server action `hostCapacity()` (OSS only) that calls `LocalProvider.hostCapacity()`.

## 3. UI: OSS resource chooser

- [x] 3.1 In `launch-configure.tsx` / `dashboard/pods/new`, render the resource chooser (CPU + memory
      number/slider) under `editionOss()`; keep the cloud tier picker as the untouched default.
- [x] 3.2 Show host total / committed-to-pods / free from the `hostCapacity()` action; warn (not block)
      when the chosen size exceeds free; note that unlimited pods aren't reserved.
- [x] 3.3 Default the chooser to "no limit"; submit `cpus`/`memoryMb` only when the owner sets them.

## 4. Metrics: per-container when limited

- [x] 4.1 MetricsSampler reads cgroup v2 (`memory.max`/`memory.current`, `cpu.max`) when `memory.max`
      is a real number; fall back to `/proc/meminfo` otherwise (Incus/LXCFS pods unchanged).
- [ ] 4.2 Verify a limited local pod reports its cgroup usage (not the host total) in the cockpit.
      (folds into 5.3 — needs a real limited pod on a Docker host)

## 5. Spec + verification

- [ ] 5.1 Apply the `self-host` spec delta (the two new requirements) and `openspec validate`.
      (change validates ✓; spec applies on `openspec archive` once shipped + live-verified — not yet.)
- [x] 5.2 Build + typecheck (provider, web, pod-agent); run the new provider tests.
      provider/control-plane/pod-agent build clean; web tsc clean; sizing tests 6/6, metrics 13/13,
      control-plane 273/273, db 9/9. (greeter PTY timeouts are the documented node-pty sandbox gap.)
- [ ] 5.3 Live check on a real Docker host: create a limited pod, confirm the container has the caps
      (`docker inspect`), the picker shows free capacity, and the cockpit metric is per-container.
