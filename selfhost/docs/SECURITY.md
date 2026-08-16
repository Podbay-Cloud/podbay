# Security guidance for Podbay Self-Hosted

Podbay Self-Hosted is currently designed for one trusted operator on a local machine or private
network. It is not a hardened multi-user hosting platform.

## Current security boundaries

- **There is one built-in owner login.** It protects the dashboard and browser terminal, but it is
  not a multi-user authorization system. On a remotely reachable fresh install, pre-seed a strong
  `PODBAY_AUTH_PASSWORD` so an unexpected first visitor cannot claim the owner account.
- **The control plane can control Docker.** The `web` and `serve` services mount the Docker socket
  so they can create and manage pods. Docker-socket access is effectively host-administrator access.
- **Pod ports are dynamically published.** The dashboard, pod previews, and pod-agent ports may be
  reachable beyond localhost. On Linux, Docker-published ports can bypass ordinary UFW or firewalld
  rules; restrict the Docker bindings or use verified `DOCKER-USER`/nftables filtering.
- **Pods share a Docker host.** Containers separate files and processes, but this alpha is not
  designed to isolate mutually untrusted users on one machine.
- **Agents can run commands and access the network.** Review instructions, skills, repositories,
  and secrets before making them available to an agent.

Prefer localhost or a private VPN/tailnet. If you expose the alpha through a public reverse proxy,
use HTTPS, keep the owner login enabled, restrict Docker-published ports with Docker-aware
filtering, and keep Docker and the host operating system patched.

## Secrets and data

Per-pod app secrets are encrypted at rest. The encryption key and the owner-session signing secret
are stored in the `podbay_appdata` Docker volume, while encrypted records and the owner credential
live in Postgres. Back up both together.

Claude authentication is performed against your Claude account. Agents and tools can also contact
third-party services required by your project. Network traffic originates from your Docker host.

Deleting a pod removes its container and workspace. Treat Git or another export as the durable copy
of important project work.

## Container images

The installer currently pulls public images from GitHub Container Registry. Pin image digests when
you need repeatable deployments. A buildable source release and its license are being prepared; the
public installer should not yet be treated as a reproducible source distribution.

## Reporting a vulnerability

Do not include exploit details, credentials, tokens, or private data in a public issue. Send
sensitive security reports to [security@podbay.cloud](mailto:security@podbay.cloud). Use
[GitHub Issues](https://github.com/podbay-cloud/install/issues) for non-sensitive installation bugs.
