#!/bin/sh
# podbay self-host installer — one command:
#   curl -fsSL <public-url>/install.sh | sh
# Checks your machine has what it needs, drops a self-contained compose.yaml into ./podbay, pulls +
# starts everything, and prints the URL. No repo clone, no build.
# Override: PODBAY_PORT (default 8080), PODBAY_DIR, PODBAY_COMPOSE_URL.
set -eu

PORT="${PODBAY_PORT:-8080}"
DIR="${PODBAY_DIR:-podbay}"
COMPOSE_URL="${PODBAY_COMPOSE_URL:-https://raw.githubusercontent.com/podbay-cloud/install/main/compose.yaml}"

say()  { printf '%s\n' "$*"; }
die()  { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# ── Requirements check — report EVERYTHING that's missing, not just the first ─────────────────
say "Checking requirements…"
missing=0
need() { # label  test-command  fix-hint
  if eval "$2" >/dev/null 2>&1; then printf '  ✓ %s\n' "$1"
  else printf '  ✗ %s — %s\n' "$1" "$3"; missing=1; fi
}
need "Docker installed"      "command -v docker"          "get it at https://docs.docker.com/get-docker/"
need "Docker running"        "docker info"                "start Docker Desktop (or the daemon) and re-run"
need "Docker Compose v2"     "docker compose version"     "update Docker Desktop, or install the docker-compose-plugin"
need "curl"                  "command -v curl"            "install curl (or set PODBAY_COMPOSE_URL + fetch manually)"
[ "$missing" -eq 0 ] || die "install the requirements above, then re-run this script."

# ── Soft warnings (non-fatal) ─────────────────────────────────────────────────────────────────
avail_gb=$(df -Pk "$PWD" 2>/dev/null | awk 'NR==2 { printf "%d", $4/1024/1024 }' || echo "")
if [ -n "$avail_gb" ] && [ "$avail_gb" -lt 6 ]; then
  say "  ⚠ only ${avail_gb} GB free here — the images need ~5 GB (plus room for pods); free some space or you may hit 'no space left'."
fi
# ── Network mode: how will this be reached? (self-host-public-previews) ────────────────────────
# local  — localhost:$PORT (private/dev; default when there's no public IP).
# ip     — public host, NO domain → per-pod preview subdomains at <id>.<ip>.sslip.io with automatic
#          HTTPS. Zero DNS setup; just open 80/443. The default when a public IP is detected.
# domain — your own domain → dashboard + <id>.pods.<domain> previews with automatic HTTPS.
# raw-ip — opt-out of sslip.io: previews on http://<public-ip>:<port> (no TLS, per-pod ports).
# Auto-detected; override with PODBAY_DEPLOY_MODE / PODBAY_DOMAIN / PODBAY_PUBLIC_IP.
pub_ip="${PODBAY_PUBLIC_IP:-}"
if [ -z "$pub_ip" ]; then
  pub_ip=$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
  [ -z "$pub_ip" ] && pub_ip=$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)
fi
# Only trust a PUBLIC IPv4 (a private/NAT address isn't reachable and would produce a dead URL).
case "$pub_ip" in
  *[!0-9.]*|"") pub_ip="" ;;
  10.*|127.*|169.254.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|192.168.*) pub_ip="" ;;
esac

MODE="${PODBAY_DEPLOY_MODE:-}"
DOMAIN="${PODBAY_DOMAIN:-}"
[ -z "$MODE" ] && { if [ -n "$DOMAIN" ]; then MODE=domain; elif [ -n "$pub_ip" ]; then MODE=ip; else MODE=local; fi; }

# `proxy` is a modifier of a public intent (ip/domain): podbay sits BEHIND an existing 80/443 proxy.
# Requested explicitly (PODBAY_DEPLOY_MODE=proxy, needs PODBAY_DOMAIN or a public IP for the host
# scheme) OR chosen automatically when 80/443 is already taken (so we coexist instead of dying).
want_proxy=0; [ "$MODE" = proxy ] && { want_proxy=1; if [ -n "$DOMAIN" ]; then MODE=domain; else MODE=ip; fi; }

DEPLOY_MODE=local; PUBLIC_BASE=""; DASHBOARD_HOST=""; PUBLIC=0
case "$MODE" in
  domain)
    [ -n "$DOMAIN" ] || die "domain mode needs PODBAY_DOMAIN=<your-domain>."
    DASHBOARD_HOST="podbay.$DOMAIN"; PUBLIC_BASE="pods.$DOMAIN"; PUBLIC=1 ;;
  ip)
    [ -n "$pub_ip" ] || die "ip mode needs a public IP — none detected. Set PODBAY_PUBLIC_IP or use PODBAY_DOMAIN."
    DASHBOARD_HOST="$pub_ip.sslip.io"; PUBLIC_BASE="$pub_ip.sslip.io"; PUBLIC=1 ;;
  raw-ip|local) DEPLOY_MODE=local ;;
  *) die "unknown PODBAY_DEPLOY_MODE='$MODE' (use local | ip | domain | proxy | raw-ip)." ;;
esac

# Is something ALREADY on 80/443 (an existing nginx/Caddy/Traefik)? Then coexist behind it.
in_use_80_443=0
if [ "$PUBLIC" -eq 1 ]; then
  for p in 80 443; do
    if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then in_use_80_443=1; fi
  done
  [ "$in_use_80_443" -eq 1 ] && want_proxy=1
fi

if [ "$PUBLIC" -eq 1 ] && [ "$want_proxy" -eq 1 ]; then
  # BEHIND-PROXY: podbay stays on $PORT (HTTP); the existing front proxy terminates TLS and forwards
  # <dashboard>/<*.base> to it. We DON'T grab 80/443 and emit a snippet for the front proxy below.
  DEPLOY_MODE=proxy; PUBLIC=0; BEHIND=1
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $PORT is in use — set PODBAY_PORT=<free port> and re-run (podbay needs one local port behind your proxy)."
  fi
elif [ "$PUBLIC" -eq 1 ]; then
  DEPLOY_MODE="$MODE"; BEHIND=0  # podbay owns 80/443 (checked free above via in_use loop)
else
  BEHIND=0
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $PORT is already in use — set PODBAY_PORT=<free port> and re-run (or free it)."
  fi
fi

# ── Compose file: use one next to a REAL install.sh (repo checkout), else download ────────────
# With `curl … | sh`, $0 is normally `sh`; resolving dirname($0) would incorrectly treat the
# CALLER'S current directory as the script directory and could start an unrelated compose.yaml.
# Only trust an adjacent file when this is actually being run as an install.sh file.
SELF_DIR=""
case "$0" in
  install.sh|*/install.sh) SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)" ;;
esac
mkdir -p "$DIR"

# ── Guard: one podbay per host ────────────────────────────────────────────────────────────────
# compose.yaml pins a fixed project name (`name: podbay`), so `docker compose up` targets the SAME
# project no matter which directory it runs from. If a podbay project already exists on this host
# managed from a DIFFERENT directory, running here would silently RECONFIGURE (and can break) it.
# Refuse rather than clobber. (Same dir = a normal update, allowed.)
here="$(cd "$DIR" && pwd)"
existing="$(docker compose ls --all 2>/dev/null | awk '$1=="podbay"{print $NF; exit}')"
if [ -n "$existing" ]; then
  first_cfg="$(printf '%s' "$existing" | cut -d, -f1)"
  existing_dir="$(cd "$(dirname "$first_cfg")" 2>/dev/null && pwd || dirname "$first_cfg")"
  if [ "$existing_dir" != "$here" ]; then
    die "podbay is already installed on this host, managed from:
      $existing_dir
    A second install from here ($here) would reconfigure that one (the compose project name is fixed).
      • To UPDATE it:   run  PODBAY_DIR='$existing_dir'  with this installer (or: cd '$existing_dir' && docker compose pull && docker compose up -d)
      • To run ANOTHER: use a separate host — one podbay per host."
  fi
fi

if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/compose.yaml" ]; then
  cp "$SELF_DIR/compose.yaml" "$DIR/compose.yaml"; say "Using compose.yaml from $SELF_DIR"
else
  say "Fetching compose.yaml…"
  curl -fsSL "$COMPOSE_URL" -o "$DIR/compose.yaml" || die "couldn't download the compose file from $COMPOSE_URL"
fi

# Deployment config compose auto-reads (.env), plus a proxy-ports override for public modes so Caddy
# can serve 80/443 with automatic HTTPS. Local mode keeps the single $PORT front door.
{
  echo "PODBAY_DEPLOY_MODE=$DEPLOY_MODE"
  echo "PODBAY_PUBLIC_BASE=$PUBLIC_BASE"
  echo "PODBAY_DASHBOARD_HOST=$DASHBOARD_HOST"
  [ "$PUBLIC" -eq 1 ] || echo "PODBAY_PORT=$PORT"
} > "$DIR/.env"
if [ "$PUBLIC" -eq 1 ]; then
  cat > "$DIR/compose.override.yaml" <<'YAML'
services:
  proxy:
    ports: !override
      - "80:80"
      - "443:443"
YAML
else
  rm -f "$DIR/compose.override.yaml" 2>/dev/null || true
fi

# ── Up (pulls images on first run) ────────────────────────────────────────────────────────────
if [ "$PUBLIC" -eq 1 ]; then say "Starting podbay ($DEPLOY_MODE mode) on 80/443 (first run pulls the images — a few minutes)…"
else say "Starting podbay on :$PORT (first run pulls the images — a few minutes)…"; fi
if ( cd "$DIR" && docker compose up -d ); then
  : # started
else
  # Classify the failure. The classic gotcha on a PUBLIC image is a STALE 'docker login ghcr.io':
  # Docker then presents expired/invalid credentials and the registry answers "denied" instead of
  # falling back to an anonymous pull. Detect that specifically and tell the user how to fix it.
  app_img=$(grep -oE 'ghcr\.io/[A-Za-z0-9._/-]*pod-app[A-Za-z0-9._:@/-]*' "$DIR/compose.yaml" 2>/dev/null | head -1)
  app_img="${app_img:-ghcr.io/podbay-cloud/pod-app:latest}"
  if docker pull "$app_img" 2>&1 | grep -qiE 'denied|unauthorized'; then
    die "image pull was DENIED for $app_img — but that image is public.

This almost always means a stale 'docker login ghcr.io' on THIS machine: Docker sends expired
credentials, and ghcr rejects them rather than pulling anonymously. Clear it and re-run:

    docker logout ghcr.io
    curl -fsSL ${PODBAY_COMPOSE_URL%/compose.yaml}/install.sh | sh"
  fi
  die "startup failed — see the errors above, resolve them, and re-run this installer."
fi

say ""
say "✅ podbay is up — your own private cloud for AI coding agents."
case "$DEPLOY_MODE" in
  domain)
    say "   Dashboard:  https://$DASHBOARD_HOST"
    say "   Previews:   https://<pod>.$PUBLIC_BASE   (automatic HTTPS)"
    say ""
    say "   DNS — create these A records pointing at THIS server, then open the dashboard:"
    say "     $DASHBOARD_HOST   →  ${pub_ip:-<this server's public IP>}"
    say "     *.$PUBLIC_BASE   →  ${pub_ip:-<this server's public IP>}"
    say ""
    say "   ⚠ If your DNS is behind Cloudflare's PROXY (orange-cloud), set these two records to"
    say "     DNS-only (grey-cloud) — the proxy intercepts port 80 and breaks Let's Encrypt's"
    say "     HTTP-01 validation, so certificates won't issue. Grey-cloud, or use a DNS-01 setup."
    ;;
  ip)
    say "   Dashboard:  https://$DASHBOARD_HOST"
    say "   Previews:   https://<pod>.$PUBLIC_BASE   (automatic HTTPS, no DNS setup — via sslip.io)"
    ;;
  proxy)
    say "   podbay is running on http://localhost:$PORT, BEHIND your existing web server (80/443 was"
    say "   already in use). Dashboard: https://$DASHBOARD_HOST · Previews: https://<pod>.$PUBLIC_BASE"
    say ""
    # The single wildcard covers BOTH the dashboard and every pod preview — podbay's own proxy
    # routes them apart by Host. Upstream differs by whether your front proxy is a host process or a
    # container (a container can't reach the host's localhost:$PORT).
    if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -qi docker; then
      up="podbay-proxy-1:8080"
      say "   ➜ Your front proxy looks CONTAINERIZED. Connect it to podbay's network once:"
      say "       docker network connect podbay_default <your-proxy-container>"
    else
      up="localhost:$PORT"
      say "   ➜ Add this to your front proxy (Caddy shown), then reload it:"
    fi
    say ""
    say "       {"
    say "           on_demand_tls { ask http://$up/api/selfhost/tls-check }"
    say "       }"
    say "       *.$PUBLIC_BASE, $DASHBOARD_HOST {"
    say "           tls { on_demand }"
    say "           reverse_proxy $up"
    say "       }"
    say ""
    case "$PUBLIC_BASE" in
      *.sslip.io) : ;;  # sslip.io resolves automatically
      *) say "   DNS: point $DASHBOARD_HOST and *.$PUBLIC_BASE at ${pub_ip:-this server} (A records)." ;;
    esac
    say "   (nginx/Traefik work too — reverse-proxy those hostnames to $up, preserving the Host header.)"
    say "   Tip: if your proxy's config is a bind-mounted file, RESTART it (not just reload) to pick up edits."
    ;;
  *)
    say "   On this machine:   http://localhost:$PORT"
    [ -n "$pub_ip" ] && say "   From elsewhere:    http://$pub_ip:$PORT   (open port $PORT; pod previews are host-local in this mode)"
    ;;
esac

if [ "$PUBLIC" -eq 1 ]; then
  # Best-effort OS firewall open (needs root); otherwise print the exact command. We can ONLY touch
  # the host firewall — a cloud security group is invisible from in here (flagged below, honestly).
  fw_hint=""
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi active; then
    if [ "$(id -u)" = 0 ]; then ufw allow 80/tcp >/dev/null 2>&1 || true; ufw allow 443/tcp >/dev/null 2>&1 || true
    else fw_hint="sudo ufw allow 80/tcp && sudo ufw allow 443/tcp"; fi
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -qi running; then
    if [ "$(id -u)" = 0 ]; then firewall-cmd --add-service=http --add-service=https --permanent >/dev/null 2>&1 || true; firewall-cmd --reload >/dev/null 2>&1 || true
    else fw_hint="sudo firewall-cmd --add-service={http,https} --permanent && sudo firewall-cmd --reload"; fi
  fi
  [ -n "$fw_hint" ] && { say ""; say "   ⚠ Open the host firewall (I couldn't — not root):  $fw_hint"; }
  say ""
  say "   I can't see your CLOUD provider's firewall / security group — it's outside this machine."
  say "   If the URL doesn't load, open TCP 80 + 443 there. HTTPS is issued on the first request to"
  say "   each new hostname, so the very first load of a pod's preview can take a few seconds."
fi
cat <<EOF

   What you just got: your own always-on cloud for AI coding agents. Open the
   dashboard and launch a pod — a ready-to-use cloud computer where Claude Code
   (or Codex) lives, keeps your project files, runs servers, and keeps working
   even when your laptop is closed.

   First, sign in:
     • New install → you'll create your owner login (pick a password). That's it.
     • Installed here before? Sign in with the password you already set.
       Forgot it, or want a clean slate?  cd $DIR && docker compose down -v
       (the -v erases everything — pods, data, and that login — so you start fresh.)

   Everyday commands (run inside ./$DIR):
     docker compose logs -f serve     # watch what podbay is doing
     docker compose down              # stop podbay — your data stays
     docker compose down -v           # stop AND erase all data

   Running this on a public server is still experimental — keep your dashboard
   private. Full guide: https://github.com/Podbay-Cloud/install/blob/main/docs/DEPLOYMENT.md
   (Advanced: set PODBAY_AUTH_PASSWORD before starting to skip the setup screen.)
EOF
