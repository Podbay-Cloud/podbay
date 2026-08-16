# Deploying Podbay Self-Hosted

This guide covers where Podbay can run and how to keep the alpha dashboard private. For routine
commands after installation, see [Operations](OPERATIONS.md).

## Choose a host

| Host | Support | Notes |
|---|---|---|
| macOS | Docker Desktop, Intel or Apple Silicon | Recommended for a first local install |
| Linux | Docker Engine and Compose v2 | Recommended for local use or a private server |
| Windows | Docker Desktop with WSL2 | Run the installer from a WSL2 shell |
| ARM64 server | Docker Engine and Compose v2 | The published images support ARM64 |

Allow at least 8 GB of memory and 6 GB of free disk space. More memory and disk are useful when a
pod installs dependencies, builds a project, or runs a database.

## Local installation

Run:

```sh
curl -fsSL https://raw.githubusercontent.com/podbay-cloud/install/main/install.sh | sh
```

By default, the installer creates `./podbay/compose.yaml`, starts the stack, and serves the
dashboard on `http://localhost:8080`. Your first visit creates the single owner login that protects
the dashboard and browser terminal.

To choose a different directory or port:

```sh
PODBAY_DIR=my-podbay PODBAY_PORT=8090 \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/podbay-cloud/install/main/install.sh)"
```

The installer does not modify system packages. It checks for Docker, Docker Compose, and `curl`,
then downloads and starts the Compose stack.

## Manual Compose installation

If you do not want to pipe an installer into a shell:

```sh
mkdir podbay && cd podbay
curl -fsSL https://raw.githubusercontent.com/podbay-cloud/install/main/compose.yaml -o compose.yaml
docker compose config
docker compose up -d
```

Read both the downloaded file and the output from `docker compose config` before starting it.

## Configuration

Set these in your shell or in a `.env` file beside `compose.yaml`:

| Variable | Default | Purpose |
|---|---|---|
| `PODBAY_PORT` | `8080` | Dashboard port on the Docker host |
| `PODBAY_APP_IMAGE` | `ghcr.io/velsa/pod-app:latest` | App image override or digest pin |
| `PODBAY_POD_IMAGE` | `ghcr.io/velsa/pod-base:latest` | Pod image override or digest pin |
| `PODBAY_AUTH_EMAIL` | `owner@localhost` | Owner email for login or pre-seeding |
| `PODBAY_AUTH_PASSWORD` | unset | Optional owner password to create before the first visit |
| `BETTER_AUTH_SECRET` | generated | Optional session-secret override; normally persisted automatically |

For a repeatable deployment, pin images by digest instead of relying on the mutable `latest` tag.

## Network exposure

The current Compose file publishes the dashboard and dynamically assigned pod ports on the Docker
host. Depending on the host firewall, other devices on the same network may be able to reach them.

For a local-only installation, bind the dashboard proxy to loopback by changing its port mapping
in `compose.yaml`:

```yaml
ports:
  - "127.0.0.1:${PODBAY_PORT:-8080}:8080"
```

Pod preview and agent ports are created dynamically by the local Docker provider. Treat the Docker
host's Docker networking configuration as part of the security boundary. On Linux, Docker's
published ports can bypass ordinary UFW or firewalld rules. Do not assume those tools alone make
the dynamic ports private.

## Running on a remote machine

> [!WARNING]
> Remote deployment is experimental in this alpha. The built-in owner login protects the dashboard
> and browser terminal, but generated preview links currently use `127.0.0.1` and dynamically
> published pod ports need separate protection. Do not expose those pod ports to the public internet.

The safest remote setup is a machine reachable only through a private VPN or tailnet:

1. Install Docker Engine and Compose v2.
2. Configure Docker itself to bind published ports only to a private interface, or add verified
   filtering in Docker's `DOCKER-USER` chain (or the equivalent nftables rules for your setup).
3. Confirm from a device outside the private network that port 8080 and the dynamic pod ports are
   unreachable.
4. Install Podbay and open the dashboard through the private network address.

If the dashboard will be reachable before you can complete first-run setup, put a strong
`PODBAY_AUTH_PASSWORD` in the `.env` file beside `compose.yaml` before starting the stack. You may
also set `PODBAY_AUTH_EMAIL`; otherwise the login email is `owner@localhost`. This removes the
first-visitor claim window. Keep the `.env` file private.

The dashboard and browser terminal can be reached this way, but app-preview buttons still point at
the remote host's `127.0.0.1` and will not open on your own device. Preview routing and a turnkey
public deployment are not available yet. If you need either, use Podbay locally for now.

## Remote Docker hosts

The runtime contains a Docker-over-SSH provider, but the one-command Compose installer does not yet
forward or configure that mode. Treat remote Docker as an unsupported development path until it is
included in a tested deployment recipe.
