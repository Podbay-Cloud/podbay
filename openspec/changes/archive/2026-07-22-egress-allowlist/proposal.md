## Why

The credential vault + `bypassPermissions` put a live subscription token in a pod with **no
outbound restriction**. A prompt-injection (malicious repo/web content) could exfiltrate it to any
host. The env spec already declares `network.policy` (none/trusted/full/custom) but **nothing
enforces it**. This is, per docs/reference/claude-config.md, the single highest-value security control.

## Decisions (from the 2026-07-10 brainstorm)

- **Enforce in-pod via a domain-allowlisting proxy + iptables, and DROP dev's sudo** so the agent
  (uid 1000) can't flush the rules. Verified on real infra that Fly pods have `NET_ADMIN`.
- **Full per-env `network.policy` now.**

## What Changes

- **Base image**: install `iptables` + `tinyproxy` (+ `dnsutils`).
- **Effective allowlist (shared/resolve)**: an always-on BASE (the agent CLIs' own endpoints +
  DNS, so the agent still works) plus, by policy:
  - `full` → no enforcement (unrestricted; sudo kept). For fully-trusted own-repo dev.
  - `trusted` → base + a curated dev set (npm/pnpm/pypi registries, GitHub, common CDNs). Default.
  - `custom` → base + the env author's `allow` domains only.
  - `none` → base only.
- **init.sh egress phase** (root, first boot, before dev runs; skipped for `full`):
  1. Write a tinyproxy config whose `Filter` allows only the effective domain list.
  2. iptables OUTPUT: allow loopback + DNS + established + the proxy process's own egress; DROP
     all other dev egress — so apps MUST use the proxy (`HTTP(S)_PROXY` set system-wide).
  3. Remove `/etc/sudoers.d/dev` so the agent can't undo any of it.
- The kickoff/permission story is unchanged; a `full`-policy env keeps today's behavior exactly.

## Capabilities

### New: `egress-allowlist`

Environments enforce their declared `network.policy` — a domain allowlist a prompt-injected agent
cannot exfiltrate around.

## Impact

- `@podbay/shared` (effective-allowlist resolve), `packages/provider/pod-base` (Dockerfile deps +
  init.sh egress phase), pod-base image rebuild + digest re-pin. No web/gateway changes.
- nextjs-starter is `trusted` → gains enforcement (with the vault + bypassPermissions, this closes
  the token-exfil hole it currently has).
- Tradeoff: non-`full` envs lose dev sudo (system deps must be baked at image build, which the
  prebuilt-template flow already does). Documented.
