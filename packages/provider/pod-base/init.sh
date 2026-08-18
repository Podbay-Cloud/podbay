#!/bin/bash
# First-boot init for a podbay pod. Reads /etc/podbay/pod-spec.json (injected by
# the provider), seeds the .claude config + permission preset, then clones the
# environment repo and runs its setup steps IN THE BACKGROUND so the terminal is
# available immediately (setup overlaps with the user's login). Markers on the
# persistent volume keep every phase run-once. Carries no credentials — the user
# authenticates the CLI inside the pod.
set -e

# pod-agent (PID 1) execs this script with an EMPTY PATH, so bare commands like
# `python3` and `iptables` (in /usr/sbin) silently fail to resolve — every
# `python3 … || true` step would no-op at boot (permission preset, egress,
# kickoff). Set a known-good PATH so the seeding actually runs.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SPEC=/etc/podbay/pod-spec.json
# The pod-spec lives on the EPHEMERAL root fs, so an image update (which recreates
# the instance from a fresh root fs) wipes it — and then this whole script skips
# the env setup (node_modules bind-mount, permissions, egress). Keep a copy on the
# persistent /home/dev volume and restore it when the root-fs copy is missing, so
# a recreate can never strip a pod's env config. Runs before any SPEC read below.
SPEC_BACKUP=/home/dev/.podbay-pod-spec.json
mkdir -p /etc/podbay
if [ -f "$SPEC" ]; then
  cp -f "$SPEC" "$SPEC_BACKUP" 2>/dev/null && chown dev:dev "$SPEC_BACKUP" 2>/dev/null || true
elif [ -f "$SPEC_BACKUP" ]; then
  cp -f "$SPEC_BACKUP" "$SPEC" 2>/dev/null || true
fi
MARKER=/home/dev/.podbay-seeded
SETUP_MARKER=/home/dev/.podbay-setup-done
SETUP_RUNNING=/home/dev/.podbay-setup-running
SETUP_LOG=/home/dev/.podbay-setup.log
WORK=/home/dev/work

# The idempotent, hash-guarded config-refresh ops (rules / settings+hook / codex-agents / skills /
# work-rules) live in refresh-common.sh — ONE source of truth shared with `podbay-refresh` (which
# applies them to a RUNNING pod with no restart). init.sh calls the SAME functions at boot below.
# shellcheck source=/dev/null
. /usr/local/bin/refresh-common.sh 2>/dev/null \
  || . "$(dirname "$0")/refresh-common.sh" 2>/dev/null \
  || { echo "podbay: FATAL refresh-common.sh not found — pod-base packaging bug (make-payload must ship it); aborting boot" >&2; exit 1; }

chown -R dev:dev /home/dev 2>/dev/null || true
mkdir -p "$WORK" /home/dev/.claude
# mkdir ran as root AFTER the chown above, so these NEW dirs are root-owned — and
# ~/work being root-owned means dev (uid 1000) can't create .next / build output
# inside it on FIRST boot (a later boot's recursive chown masks it). Chown the
# dirs we just made so the dev server works on the very first boot.
chown dev:dev "$WORK" /home/dev/.claude 2>/dev/null || true

# Pre-seed the CLI's first-run state so LOGIN IS THE ONLY INTERACTIVE STEP. Every key
# here suppresses a modal that would otherwise block an unattended session:
#   theme/hasCompletedOnboarding      — the first-run theme picker
#   bypassPermissionsModeAccepted     — the "Bypass Permissions mode" accept screen. The
#                                       launcher runs `--permission-mode bypassPermissions`,
#                                       and that gate's DEFAULT option is "No, exit".
#   remoteControlAtStartup            — connect every session to the user's Claude apps
#   remoteDialogSeen                  — the "Enable Remote Control / Never mind" modal
#   projects[work].hasTrustDialogAccepted — folder-trust, which otherwise interrupts the
#                                       post-login continuation and bounces to the auth menu
#
# ONE pass that both creates and repairs. This used to be two blocks: a `[ ! -f ]` create
# and a repair pass that setdefault'd only the two remote-control keys. That split caused
# a real outage (2026-07-24, pod prime-cat-8ba8): Claude Code itself writes ~/.claude.json
# during /login, so the create branch was skipped, the repair pass added only the RC keys,
# and bypassPermissionsModeAccepted was never set on ANY pod where login happened first.
# The pod then hit the accept screen, whose default is "No, exit" — Claude exited and
# every subsequent scripted keystroke landed in bash.
# setdefault ONLY — never clobber a choice the user actually made — written via a temp
# file so a crash can't truncate the live config.
# >>> podbay:claude-config-seed — base-image.test.ts extracts this python and runs it
# against PODBAY_CLAUDE_JSON, so the create/repair behaviour is covered by a real test.
python3 - <<'PY' || true
import json, os, tempfile
p = os.environ.get("PODBAY_CLAUDE_JSON", "/home/dev/.claude.json")
try:
    with open(p) as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
except Exception:
    raise SystemExit(0)          # unreadable/partial: leave it alone
if not isinstance(cfg, dict):
    raise SystemExit(0)
before = json.dumps(cfg, sort_keys=True)

for k, v in {
    "theme": "dark",
    "hasCompletedOnboarding": True,
    "bypassPermissionsModeAccepted": True,
    "remoteDialogSeen": True,
    "remoteControlAtStartup": True,
}.items():
    cfg.setdefault(k, v)

projects = cfg.setdefault("projects", {})
if isinstance(projects, dict):
    work = projects.setdefault("/home/dev/work", {})
    if isinstance(work, dict):
        for k, v in {
            "hasTrustDialogAccepted": True,
            "projectOnboardingSeenCount": 5,
            "hasClaudeMdExternalIncludesApproved": False,
            "hasClaudeMdExternalIncludesWarningShown": True,
        }.items():
            work.setdefault(k, v)

if json.dumps(cfg, sort_keys=True) != before:
    d = os.path.dirname(p)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d)
    with os.fdopen(fd, "w") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, p)
    print("init: seeded/repaired claude first-run config")
PY
# <<< podbay:claude-config-seed
chown dev:dev /home/dev/.claude.json 2>/dev/null || true

# Pre-trust the workspace for CODEX so its "Do you trust the contents of this directory?"
# gate never interrupts the post-login session (the codex analog of hasTrustDialogAccepted
# above). Codex records folder trust in ~/.codex/config.toml as
#   [projects."<path>"]
#   trust_level = "trusted"
# Verified live on codex-cli 0.145.0: with the entry present codex boots straight to the
# prompt; without it the trust gate blocks and needs a keypress. We trust /home/dev/work
# (the agent's cwd) and /home/dev (the `cd ~/work || cd ~` fallback). Codex writes this file
# itself, so — like the claude seed — this is a create-AND-repair pass: it APPENDS a trusted
# entry only for a path NOT already present, and never rewrites a table codex or the user
# wrote (rewriting risks emitting invalid TOML / duplicate keys). A present-but-untrusted
# path is left as-is (respect an explicit decline).
# >>> podbay:codex-config-seed — base-image.test.ts extracts this python and runs it against
# PODBAY_CODEX_TOML, so the create/repair behaviour is covered by a real test.
python3 - <<'PY' || true
import os, tempfile
p = os.environ.get("PODBAY_CODEX_TOML", "/home/dev/.codex/config.toml")
TRUST = ("/home/dev/work", "/home/dev")
text = ""
if os.path.exists(p):
    try:
        with open(p, "rb") as f:
            text = f.read().decode("utf-8", "replace")
    except Exception:
        raise SystemExit(0)          # unreadable: leave it alone
present = set()
if text.strip():
    try:
        import tomllib
        projects = tomllib.loads(text).get("projects", {})
        if isinstance(projects, dict):
            present = set(projects.keys())
    except Exception:
        raise SystemExit(0)          # partial/invalid: never risk rewriting it
add = ""
for path in TRUST:
    if path not in present:
        add += '\n[projects."%s"]\ntrust_level = "trusted"\n' % path
# Suppress codex's interactive "Update available … Press enter" gate. On a pod
# nobody is at the keyboard, so that prompt just stops the agent from ever
# starting (seen live 2026-07-29). Boot passes the same flag; this covers a codex
# the USER starts by hand in the terminal.
#
# PREPENDED, not appended: a bare key written after a [table] header belongs to
# that table, so appending it would have set projects."/home/dev".
# check_for_update_on_startup — silently the wrong key (caught by the test below).
prefix = "" if "check_for_update_on_startup" in text else "check_for_update_on_startup = false\n"
if add or prefix:
    body = (text.rstrip("\n") + "\n" + add) if text.strip() else add.lstrip("\n")
    new = prefix + body
    d = os.path.dirname(p)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d)
    with os.fdopen(fd, "w") as f:
        f.write(new)
    os.replace(tmp, p)
    print("init: seeded codex directory trust")
PY
# <<< podbay:codex-config-seed
chown dev:dev /home/dev/.codex /home/dev/.codex/config.toml 2>/dev/null || true

# ---- Guest hostname = the pod's chosen name -------------------------------
# The Codex app labels a pod by the `server_name` on its remote-control
# enrollment, which is captured from the HOSTNAME at the pod's FIRST enrollment
# and then fixed SERVER-SIDE forever: renaming the host afterwards does nothing,
# and clearing the local record re-registers under the SAME id and old name
# (both verified live, 2026-07-29). So the only chance to make the app show the
# user's name is to set the hostname BEFORE the RC daemon ever runs — i.e. here,
# in first-boot init, which runs before the pod-agent starts it.
#
# Sanitised to RFC-1123 (lowercase alphanumerics + dashes): "byo test" → "byo-test".
# Falls back to leaving the slug alone when the pod has no name or it sanitises
# to nothing. Renaming a pod LATER cannot move the Codex label; that is a
# platform limit, not an oversight.
# >>> podbay:pod-hostname
POD_NAME_RAW="${POD_NAME_RAW:-$(python3 -c 'import json; print(json.load(open("/etc/podbay/pod-spec.json")).get("podName") or "")' 2>/dev/null)}"
POD_HOSTNAME="$(printf '%s' "$POD_NAME_RAW" | tr "[:upper:]" "[:lower:]" | tr -c "a-z0-9-" "-" | sed "s/-\{2,\}/-/g; s/^-//; s/-$//" | cut -c1-63)"
if [ -n "$POD_HOSTNAME" ] && [ "$POD_HOSTNAME" != "$(hostname)" ]; then
  echo "podbay: hostname → $POD_HOSTNAME (pod name)"
  hostname "$POD_HOSTNAME" 2>/dev/null || true
  echo "$POD_HOSTNAME" > /etc/hostname 2>/dev/null || true
fi
# <<< podbay:pod-hostname

# ---- Codex standalone build: seed the RC-daemon binary onto the volume ----
# `codex remote-control start` (the daemon that makes a pod pairable from the Codex
# app) needs the STANDALONE build at ~/.codex/packages/standalone/current/codex — the
# npm codex can't daemonize. The image stages it at /opt/podbay/codex-standalone
# (rootfs); copy it onto the persistent ~/.codex volume once, for codex pods (it
# self-updates from there). The installer's `current` symlink is ABSOLUTE to the
# staging path, so repoint it RELATIVE after the copy. The pod-agent then starts the
# daemon (server.ts ensureCodexDaemon) — this just puts the binary where it looks.
# >>> podbay:codex-standalone-seed — base-image.test.ts extracts + runs this against
# CODEX_SA_* overrides, so the copy + symlink-fix are covered by a test.
# ANY declared agent, not agents[0]. Keying on the PRIMARY meant a Claude pod that
# later gained Codex never got the daemon binary — so its "turn remote control on"
# could never work, silently, forever (live find: cheerful-donkey-6bc4, 2026-07-29).
CODEX_SA_AGENT="${CODEX_SA_AGENT:-$(python3 -c 'import json; a=json.load(open("/etc/podbay/pod-spec.json")).get("agents") or []; print("codex" if "codex" in a else (a[0] if a else ""))' 2>/dev/null)}"
CODEX_SA_SRC="${CODEX_SA_SRC:-/opt/podbay/codex-standalone/packages/standalone}"
CODEX_SA_DST="${CODEX_SA_DST:-/home/dev/.codex/packages/standalone}"
CODEX_SA_OWNER="${CODEX_SA_OWNER:-dev:dev}"
if [ "$CODEX_SA_AGENT" = "codex" ] && [ -d "$CODEX_SA_SRC" ] && [ ! -x "$CODEX_SA_DST/current/codex" ]; then
  echo "podbay: seeding codex standalone build (RC daemon)"
  mkdir -p "$(dirname "$CODEX_SA_DST")"
  if cp -a "$CODEX_SA_SRC" "$CODEX_SA_DST"; then
    REL=$(ls -1 "$CODEX_SA_DST/releases/" 2>/dev/null | head -1)
    [ -n "$REL" ] && ln -sfn "releases/$REL" "$CODEX_SA_DST/current"   # abs → relative
    chown -R "$CODEX_SA_OWNER" "$(dirname "$CODEX_SA_DST")" 2>/dev/null || true
  else
    echo "podbay: codex standalone seed FAILED"
  fi
fi

# ---- Enforce the standalone PIN ------------------------------------------
# The standalone build SELF-UPDATES: it downloads a new release onto the volume
# and repoints `current` at it (found live 2026-07-29 — both pods were running
# 0.146.0 while the image shipped 0.145.0, and the npm codex then greeted users
# with an update prompt because the two had diverged). A pod that silently swaps
# a component we depend on for pairing is not reproducible, and a broken release
# would hit every Codex pod with nothing in our repo having changed.
#
# So on every boot: make sure the PINNED release (the one staged in the image, of
# which there is exactly one) is present on the volume and `current` points at it.
# This undoes a self-update rather than trying to prevent one — the CLI offers no
# switch for that. Relative symlink so it survives the copy.
# >>> podbay:codex-standalone-pin
CODEX_SA_PIN="${CODEX_SA_PIN:-$(ls -1 "$CODEX_SA_SRC/releases" 2>/dev/null | head -1)}"
if [ -n "$CODEX_SA_PIN" ] && [ -d "$CODEX_SA_DST/releases" ]; then
  if [ ! -d "$CODEX_SA_DST/releases/$CODEX_SA_PIN" ] && [ -d "$CODEX_SA_SRC/releases/$CODEX_SA_PIN" ]; then
    cp -a "$CODEX_SA_SRC/releases/$CODEX_SA_PIN" "$CODEX_SA_DST/releases/$CODEX_SA_PIN" 2>/dev/null || true
  fi
  if [ -d "$CODEX_SA_DST/releases/$CODEX_SA_PIN" ] &&
     [ "$(readlink "$CODEX_SA_DST/current" 2>/dev/null)" != "releases/$CODEX_SA_PIN" ]; then
    echo "podbay: pinning codex standalone → $CODEX_SA_PIN (was $(readlink "$CODEX_SA_DST/current" 2>/dev/null || echo none))"
    ln -sfn "releases/$CODEX_SA_PIN" "$CODEX_SA_DST/current"
    chown -h "$CODEX_SA_OWNER" "$CODEX_SA_DST/current" 2>/dev/null || true
  fi
fi
# <<< podbay:codex-standalone-pin
# <<< podbay:codex-standalone-seed

# Universal runtime-rules layer → user-level ~/.claude/CLAUDE.md (applies in every
# directory). Podbay-authored, identical in every pod.
#
# This USED to be a bare "create if missing" guard, which was silently broken: /home/dev
# is a PERSISTENT volume, so the file outlives restarts, suspend/resume AND image
# updates — meaning a pod created once could NEVER receive a rules update. Shipping the
# confirm-before-outbound rule (2026-07-23) reached zero existing pods because of it.
#
# So: track what podbay last wrote in a marker. If the on-disk file is still exactly
# what we wrote, refresh it. If the user changed it, leave theirs alone and drop the new
# canonical copy beside it so an update is never silently lost.
pb_refresh_runtime_rules

# Permission preset → ~/.claude/settings.json, refreshed EVERY boot (NOT seed-once).
# Same lesson as the runtime-rules refresh above: settings.json lives on the persistent
# volume, so the old seed-once write froze the preset — a fix or a new `deny` never
# reached an existing pod (the 2026-08-01 git-push change reached zero of them). This
# refreshes only the podbay-MANAGED fields (mode + allow/deny/ask) from the spec,
# PRESERVES any other keys, and backs off if the user edited the managed fields.
pb_refresh_settings

# ---- Codex rule literacy → ~/.codex/AGENTS.md (the codex analog of CLAUDE.md) ----
# Claude reads ~/.claude/CLAUDE.md (universal rules) + ~/work/CLAUDE.md (env rules),
# but Codex reads NEITHER — its instruction mechanism is AGENTS.md. So a codex pod
# ran WITHOUT the universal confirm-before-outbound rule or the env's rules. Codex
# DOES read the global ~/.codex/AGENTS.md (verified live on codex-cli 0.145.0), which
# applies in every project and — unlike ~/work/AGENTS.md — never dirties a BYO repo.
# So for codex pods, assemble the universal runtime rules + the env's .claude/rules
# into a DELIMITED podbay block in ~/.codex/AGENTS.md: block-replacement so it is
# non-destructive (anything the user/codex wrote outside the block is preserved),
# idempotent, and regenerated every boot so a rules update reaches existing pods on
# the next image cycle. Codex-pods only.
pb_refresh_codex_agents

# Agent credentials are NEVER injected (opsx per-pod-login): each pod does its
# own /login on first boot; the login lives on the pod's persistent volume.

# App secrets (opsx pod-secrets): the per-pod secrets file is injected by the
# provider (machine file at launch, or via exec on wake). Lock it to 0600 dev-owned
# and source it from ~/.bashrc under `set -a` so values land in the environment of
# anything the agent launches. Deliberately NOT written into ~/work (git-leak). The
# file lives on the ephemeral rootfs; the control plane re-injects from the DB on
# each wake (the DB is the source of truth), so this runs on EVERY boot.
mkdir -p /etc/podbay
if [ -f /etc/podbay/secrets.env ]; then
  chmod 600 /etc/podbay/secrets.env
  chown dev:dev /etc/podbay/secrets.env 2>/dev/null || true
fi
# One loader, sourced from every shell type — because the agent's shells and the
# app dev-server do NOT read ~/.bashrc: Claude Code runs its tools via `bash -c`
# (non-interactive), which reads $BASH_ENV but not ~/.bashrc, so a secret added
# while the pod is running never reached the agent or the app it launches. We wire
# BASH_ENV (non-interactive shells, incl. the agent's) + /etc/profile.d (login
# shells; the boot `bash -lc` exports BASH_ENV so `claude` and its children inherit
# it) + ~/.bashrc (interactive). Re-sourced per shell, so a live-added secret is
# picked up by the next command / next `pnpm dev`. Written every boot (idempotent).
cat > /etc/podbay/secrets-load.sh <<'LOADER'
# podbay: default DATABASE_URL points at the pod's local Postgres (every pod has
# one; see init.sh). A user-set DATABASE_URL secret overrides it — secrets.env is
# sourced AFTER, so it wins.
export DATABASE_URL="${DATABASE_URL:-postgresql://dev@localhost:5432/app}"
# The pod-local relay egress proxy. Pre-wired so an app uses the owner's connection with
# ZERO config, and FAIL-CLOSED: with no relay running the pod-agent refuses the CONNECT,
# so this is simply inert until the owner runs `relay start`. Deliberately NOT
# HTTP(S)_PROXY — that would push the agent's own control-plane traffic through the
# owner's home network. Apps opt in (a crawler's CRAWLER_PROXY_URL, a browser's proxy).
export PODBAY_RELAY_PROXY="socks5://127.0.0.1:${PODBAY_RELAY_PROXY_PORT:-1080}"
# load per-pod app secrets (see /etc/podbay/secrets.env). Re-sourced per shell so a
# secret added after the pod started is picked up on the next command.
[ -f /etc/podbay/secrets.env ] && { set -a; . /etc/podbay/secrets.env; set +a; }
LOADER
chmod 644 /etc/podbay/secrets-load.sh
cat > /etc/profile.d/podbay-secrets.sh <<'PROFILE'
# podbay: load secrets into login shells, and export BASH_ENV so the agent's
# non-interactive `bash -c` tool shells (and the dev servers they start) load them.
export BASH_ENV=/etc/podbay/secrets-load.sh
[ -f /etc/podbay/secrets-load.sh ] && . /etc/podbay/secrets-load.sh
PROFILE
chmod 644 /etc/profile.d/podbay-secrets.sh
BASHRC=/home/dev/.bashrc
if ! grep -q 'secrets-load.sh' "$BASHRC" 2>/dev/null; then
  cat >> "$BASHRC" <<'RC'
# podbay: load per-pod app secrets into interactive shells (see secrets-load.sh)
[ -f /etc/podbay/secrets-load.sh ] && . /etc/podbay/secrets-load.sh
# Interactive pod shell only — nothing below touches the agent's non-interactive
# `bash -c` tool shells, so no alias or prompt can ever hang a command.
[[ $- != *i* ]] && return

shopt -s checkwinsize histappend cmdhist globstar autocd cdspell dirspell 2>/dev/null

# History: generous (a pod is long-lived, disk is cheap), de-duped, timestamped,
# and flushed on every prompt so the web terminal and Claude's own shells don't
# clobber each other and a suspend never loses it.
HISTCONTROL=ignoreboth
HISTSIZE=20000
HISTFILESIZE=40000
HISTTIMEFORMAT='%F %T '

export PAGER=less LESS='-R' CLICOLOR=1

# Completion, when installed
for file in \
    /usr/share/bash-completion/bash_completion \
    /etc/bash_completion
do
    [[ -r $file ]] && source "$file" && break
done
unset file
command -v gh >/dev/null 2>&1 && eval "$(gh completion -s bash 2>/dev/null)"

# Colors only when supported
if [[ -t 1 && ${TERM:-dumb} != dumb ]]; then
    RESET='\[\e[0m\]'
    RED='\[\e[31m\]'
    GREEN='\[\e[32m\]'
    YELLOW='\[\e[33m\]'
    BLUE='\[\e[34m\]'
    CYAN='\[\e[36m\]'
else
    RESET='' RED='' GREEN='' YELLOW='' BLUE='' CYAN=''
fi

_git_branch() {
    command git symbolic-ref --quiet --short HEAD 2>/dev/null ||
        command git rev-parse --short HEAD 2>/dev/null
}

_set_prompt() {
    local code=$?
    local status='' branch=''

    (( code )) && status="${RED}✗ ${code} ${RESET}"

    branch=$(_git_branch)
    [[ -n $branch ]] && branch=" ${YELLOW}(${branch})${RESET}"

    # POD_NAME can be injected through the pod spec; falls back to the hostname.
    local pod="${POD_NAME:-${HOSTNAME%%.*}}"

    PS1="${status}${GREEN}\u@${pod}${RESET} ${BLUE}\w${RESET}${branch}"
    PS1+="\n${CYAN}"'\$'"${RESET} "
}

# _set_prompt FIRST so its $? is the command's exit code, THEN flush history.
PROMPT_COMMAND='_set_prompt; history -a'

# Up/Down search history by the prefix already typed (big dev-ergonomics win).
bind '"\e[A": history-search-backward' 2>/dev/null
bind '"\e[B": history-search-forward' 2>/dev/null

alias ls='ls --color=auto'
alias ll='ls -alFh'
alias la='ls -A'
alias src='source ~/.bashrc'
alias grep='grep --color=auto'
alias ..='cd ..'
alias ...='cd ../..'
alias gs='git status --short --branch'
alias gd='git diff'
alias gl='git log --graph --decorate --oneline -20'

mkcd() {
    mkdir -p -- "$1" && cd -- "$1"
}
RC
  chown dev:dev "$BASHRC" 2>/dev/null || true
fi

# tmux runs new windows (ctrl-b c) as LOGIN shells, which read ~/.bash_profile /
# ~/.profile — NOT ~/.bashrc. The dev home volume ships neither, so a new window
# got none of the presets (aliases/prompt/history) until `source ~/.bashrc`. A
# one-line ~/.bash_profile that sources ~/.bashrc fixes every login shell.
if [ ! -f /home/dev/.bash_profile ]; then
  printf '%s\n' '[ -f ~/.bashrc ] && . ~/.bashrc' > /home/dev/.bash_profile
  chown dev:dev /home/dev/.bash_profile 2>/dev/null || true
fi

# ---- Egress allowlist enforcement (EVERY boot — iptables state is ephemeral,
# so this is deliberately NOT marker-guarded like the seed phases above) ----
# When the env's policy sets egress.enforce, force all outbound agent TCP :80/:443
# through the transparent SNI proxy, which only forwards to allowlisted domains.
# Fly's kernel has no iptables owner/cgroup match, so the REJECT-all-else hits
# every uid; we explicitly spare loopback, DNS, established flows, the Fly 6PN
# control net (inbound SSH via hallpass + logs), the redirected→proxy hop, and
# the proxy's own upstream dials (fwmark 0x1, which also breaks the redirect loop).
if [ -f "$SPEC" ] && [ -x /usr/local/bin/podbay-egress ]; then
  EGRESS_ENFORCE=$(python3 -c 'import json; e=json.load(open("/etc/podbay/pod-spec.json")).get("egress") or {}; print("1" if e.get("enforce") else "")' 2>/dev/null || true)
  if [ -n "$EGRESS_ENFORCE" ]; then
    mkdir -p /etc/podbay
    python3 -c 'import json; e=json.load(open("/etc/podbay/pod-spec.json")).get("egress") or {}; open("/etc/podbay/egress-domains","w").write("\n".join(e.get("domains",[]))+"\n")' 2>/dev/null || true

    # Root-owned, started before the rules so :3129 is bound (dev can't rebind it);
    # if it ever dies the REDIRECT fails closed. Reads the allowlist once at start.
    if ! pgrep -x podbay-egress >/dev/null 2>&1; then
      PODBAY_EGRESS_ALLOWLIST=/etc/podbay/egress-domains \
        nohup /usr/local/bin/podbay-egress >/var/log/podbay-egress.log 2>&1 &
    fi

    for ipt in iptables ip6tables; do
      $ipt -t nat -F OUTPUT 2>/dev/null || true
      $ipt -t nat -A OUTPUT -p tcp -m mark --mark 0x1 -j RETURN
      $ipt -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-ports 3129
      $ipt -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-ports 3129
      $ipt -F OUTPUT 2>/dev/null || true
      $ipt -A OUTPUT -o lo -j ACCEPT
      # Fly's inbound SSH (hallpass on :22) is NOT reliably matched by the
      # ESTABLISHED rule on this kernel, so permit SSH-server replies explicitly
      # or `fly ssh` into an enforced pod hangs. Safe: a uid-1000 process can't
      # bind :22 (root, dropped below) and client dials never use source port 22.
      $ipt -A OUTPUT -p tcp --sport 22 -j ACCEPT
      $ipt -A OUTPUT -p tcp --dport 3129 -j ACCEPT
      $ipt -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
      $ipt -A OUTPUT -p udp --dport 53 -j ACCEPT
      $ipt -A OUTPUT -p tcp --dport 53 -j ACCEPT
      $ipt -A OUTPUT -p tcp -m mark --mark 0x1 -j ACCEPT
    done
    ip6tables -A OUTPUT -d fdaa::/16 -j ACCEPT 2>/dev/null || true
    iptables  -A OUTPUT -j REJECT
    ip6tables -A OUTPUT -j REJECT
    # Drop dev's passwordless sudo: with root the agent could flush the rules,
    # so enforcement and sudo are mutually exclusive (system packages must be
    # baked into the image for locked-down envs, not apt-installed at runtime).
    rm -f /etc/sudoers.d/dev
    echo "podbay: egress enforcement active"
  fi
fi

# Agent-led onboarding: the env's kickoff prompt travels as a FILE (never
# shell-interpolated) — the boot command runs `claude "$(cat ~/.podbay-kickoff)"`.
if [ -f "$SPEC" ] && [ ! -f /home/dev/.podbay-kickoff ]; then
  python3 - "$SPEC" <<'PY' || true
import json, sys
k = json.load(open(sys.argv[1])).get("kickoff")
if k:
    open("/home/dev/.podbay-kickoff", "w").write(k)
PY
  chown dev:dev /home/dev/.podbay-kickoff 2>/dev/null || true
fi

# Codex skills translation, as a function so it runs BOTH in the first-boot seed and on
# EVERY boot (below). Boot-seed-only meant a codex added at RUNTIME (`podbay agent add` /
# the cockpit's Add agent) never got the env's skills — and a reboot didn't heal it either,
# because the seed marker already existed. AGENTS.md already regenerates every boot; this
# gives skills the same property, so a runtime-added codex is literate on the next boot and
# an env's skill updates reach existing pods on the image cycle. Idempotent + non-destructive:
# it no-ops unless the pod declares codex AND the pushed skill sources are present.
translate_codex_skills() {
    # ---- Codex skills: translate the env's Claude skills into ~/.codex/skills ----
    # An env ships skills in Claude shape (<name>/SKILL.md + support files), but Codex
    # discovers skills from ~/.codex/skills/<name>/SKILL.md — a DIFFERENT location it
    # never reads the Claude layer for, so without this a Codex pod gets none of its
    # env's skills. The formats are compatible: VERIFIED on codex-cli 0.145.0 that a
    # skill dir dropped into ~/.codex/skills is auto-discovered (`codex exec` listed it
    # among its skills) AND that Claude-only frontmatter keys (user-invocable,
    # allowed-tools, argument-hint) are tolerated — so translation is a straight copy of
    # each skill dir. Codex-pods only; the reserved .system/ built-ins are never touched.
    # Run-once like the .claude seed above (parity). Codex reads instructions from
    # AGENTS.md not CLAUDE.md, so env RULES are a separate concern — this is SKILLS only.
    pb_translate_codex_skills
}

if [ -f "$MARKER" ]; then
  echo "podbay: already seeded"
elif [ ! -f "$SPEC" ]; then
  # NO MARKER HERE. The provider pushes /etc/podbay/{pod-spec.json,claude/...} only
  # AFTER the guest agent is up, so the boot-time run of this script legitimately
  # finds no spec — it then restarts podbay-agent so this script re-runs WITH the
  # spec. Writing the marker on that first spec-less pass permanently skipped the
  # seed (the .claude layer: skills + rules + settings). Verified live on
  # everyday-harrier-ae1b 2026-07-23: marker 20:07:31, spec 20:07:33 — byo-project's
  # 8 skills never landed, so the agent reported /codebase-onboarding "not
  # registered" and fell back to manual orientation.
  echo "podbay: no pod-spec yet — deferring seed to the post-push agent restart"
else
  if [ -f "$SPEC" ]; then
    # BYO-repo (docs/plans/byo-repo-plan.md): ~/work is the USER's OWN git tree, so
    # seed the env's .claude layer at USER level (~/.claude) — NEVER into the repo,
    # which would dirty `git status` and clobber their own CLAUDE.md. A normal env
    # workspace (prebuilt template) seeds into ~/work as before. Claude Code loads
    # user-level ~/.claude/skills too, so byo-project's skills still activate.
    GH_REPO=$(python3 -c 'import json; print(json.load(open("/etc/podbay/pod-spec.json")).get("githubRepo") or "")' 2>/dev/null || true)
    # BYO seeds at USER level (~/.claude), a normal workspace into ~/work. Never
    # swallow the result: a missing layer means the env's skills/rules are silently
    # dead in the pod, which is invisible until an agent tries to run a skill.
    if [ -n "$GH_REPO" ]; then CLAUDE_DEST=/home/dev/.claude; else CLAUDE_DEST="$WORK/.claude"; fi
    if [ -d /etc/podbay/claude ]; then
      mkdir -p "$CLAUDE_DEST"
      if cp -r /etc/podbay/claude/. "$CLAUDE_DEST/"; then
        echo "podbay: seeded .claude layer → $CLAUDE_DEST ($(find /etc/podbay/claude -type f | wc -l) files, $(ls /etc/podbay/claude/skills 2>/dev/null | wc -l) skills)"
      else
        echo "podbay: ERROR copying .claude layer → $CLAUDE_DEST"
      fi
      chown -R dev:dev "$CLAUDE_DEST" 2>/dev/null || true
    elif python3 -c 'import json,sys; sys.exit(0 if json.load(open("/etc/podbay/pod-spec.json")).get("claudeFiles") else 1)' 2>/dev/null; then
      # The spec's claudeFiles manifest lists files the provider meant to push, but
      # /etc/podbay/claude is absent — the push dropped them (see the Incus
      # start-before-push rule in incus/provider.ts). Loud, not silent.
      echo "podbay: ERROR pod-spec lists claudeFiles but /etc/podbay/claude is MISSING — env skills/rules will NOT be active"
    fi

    translate_codex_skills

    # Rules → ~/work/CLAUDE.md. Claude Code auto-loads the project CLAUDE.md but
    # NOT an arbitrary .claude/rules/ dir, so without this the env's rules (no-spam,
    # web-build-discipline, …) are dead files. Assemble them into CLAUDE.md (which
    # IS loaded) unless the env shipped its own CLAUDE.md.
    # SKIPPED for BYO: a brought repo keeps its own CLAUDE.md and we never write
    # into the user's tree.
    #
    # Refresh policy (2026-07-28, seed-once audit): was `[ ! -f CLAUDE.md ]` —
    # seed-once on a persistent volume, so a RULE change never reached existing
    # pods even once seed-on-update landed (the class behind "shipped but never
    # delivered"). Now the same hash-marker pattern as ~/.claude/CLAUDE.md above:
    # regenerate when OUR last write is untouched; if the user edited it, it's
    # THEIR file — leave it alone (their edit outranks our refresh).
    pb_refresh_work_rules
    # (settings.json is now written by the every-boot podbay:settings-refresh block above,
    # not here — a seed-once write froze the preset on existing pods.)
  fi
  chown -R dev:dev /home/dev 2>/dev/null || true
  touch "$MARKER"
  chown dev:dev "$MARKER" 2>/dev/null || true
  echo "podbay: seed complete"
fi

ENV_NAME=$(python3 -c 'import json; print(json.load(open("/etc/podbay/pod-spec.json")).get("envName",""))' 2>/dev/null || true)

# ---- ~/work ownership guard (EVERY boot; cheap defensive re-assert) ----
# /home/dev is now a BLOCK volume (ext4), mounted by podbay-home-mount.service
# BEFORE this runs — so the early chown at the top of this script works natively
# and this is just belt-and-suspenders (also covers the rare fallback where the
# mount didn't happen). Not -R: that would recurse into the node_modules bind-mount.
chown dev:dev "$WORK" /home/dev/.claude 2>/dev/null || true

# ---- Auto-start the dev server for prebuilt web-app pods ----
# The kickoff used to tell the agent to run `pnpm dev`, which proved fragile (a
# stray `&` exited the tool wrapper → "Background shell failed"; a retry collided
# on :3000). Start it here instead, so the preview is live the moment the pod boots
# and the agent never has to. Only for a workspace whose package.json has a `dev`
# script. Idempotent (skips if :3000 already answers or our launched pid is alive),
# non-fatal, and NOT marker-guarded — the process doesn't survive sleep/wake, so
# it must be re-run on EVERY boot (called after the postgres block for wake, and
# from the background setup phase after the first-boot source copy).
DEV_PIDFILE=/home/dev/.podbay-dev.pid
DEV_LOG=/home/dev/.podbay-dev.log
start_dev_server() {
  [ -f "$WORK/package.json" ] || return 0
  # Durable opt-out: a pod that serves its OWN :3000 (a production `next start` via `podbay startup`)
  # runs `podbay dev disable`, which drops this file. Without this guard the auto `pnpm dev` races the
  # prod server for :3000 and `next dev` clobbers the prod .next in place (the makore.app outage).
  if [ -f /home/dev/.podbay/dev-server-disabled ]; then
    echo "podbay: dev server disabled (podbay dev enable to re-enable)"
    return 0
  fi
  su dev -c "jq -e '.scripts.dev // empty' '$WORK/package.json'" >/dev/null 2>&1 || return 0
  if [ -f "$DEV_PIDFILE" ] && kill -0 "$(cat "$DEV_PIDFILE" 2>/dev/null)" 2>/dev/null; then return 0; fi
  curl -sf -o /dev/null --max-time 1 http://localhost:3000 2>/dev/null && return 0
  echo "podbay: starting dev server (pnpm dev) on :3000"
  su - dev -c "cd '$WORK' && nohup pnpm dev >> '$DEV_LOG' 2>&1 & echo \$! > '$DEV_PIDFILE'" \
    || echo "podbay: dev server start FAILED"
  chown dev:dev "$DEV_PIDFILE" "$DEV_LOG" 2>/dev/null || true
}

# ---- Agent-declared startup commands (EVERY boot) ----
# The dev server above is the special case; this is the general one. An agent can
# declare long-running processes (a second server, a worker, a queue) in
# ~/.podbay/startup.json — kept OUTSIDE ~/work so it never lands in a BYO user's repo —
# and we relaunch each on every boot. Same rationale as the dev server: a bare
# `nohup &` dies on restart and /etc resets, so durability has to live here. Written
# via `podbay startup`. Idempotent per command (skips if its recorded pid is alive),
# non-fatal, never touches ~/work. Called at the same two sites as start_dev_server.
STARTUP_JSON=/home/dev/.podbay/startup.json
STARTUP_DIR=/home/dev/.podbay/startup
run_startup_commands() {
  [ -f "$STARTUP_JSON" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  su dev -c "jq -e '.commands? // empty' '$STARTUP_JSON'" >/dev/null 2>&1 || return 0
  install -d -o dev -g dev "$STARTUP_DIR" 2>/dev/null || mkdir -p "$STARTUP_DIR"
  # Emit one TSV line per enabled command: <slug>\t<command>
  local line slug cmd pid pidfile logfile
  while IFS=$'\t' read -r slug cmd; do
    [ -n "$slug" ] || continue
    pidfile="$STARTUP_DIR/$slug.pid"
    logfile="$STARTUP_DIR/$slug.log"
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null; then continue; fi
    echo "podbay: starting declared startup command '$slug'"
    su - dev -c "cd '$WORK' && nohup bash -lc '$cmd' >> '$logfile' 2>&1 & echo \$! > '$pidfile'" \
      || echo "podbay: startup command '$slug' FAILED to launch"
    chown dev:dev "$pidfile" "$logfile" 2>/dev/null || true
  done < <(su dev -c "jq -r '.commands[]? | select(.enabled != false and (.command // \"\") != \"\") | [(.slug // \"cmd\"), .command] | @tsv' '$STARTUP_JSON'" 2>/dev/null)
}

# ---- Prebuilt node_modules: bind-mount from the image (EVERY boot) ----
# The env template ships a large node_modules baked into the image (20k+ files,
# ~450MB). Copying that onto the /home/dev volume takes MINUTES on a cold pod — the
# single biggest launch cost — so instead we bind-mount it from the image: instant,
# and Turbopack/Next see a real directory (a symlink is rejected as "outside the
# project root"). Re-established on EVERY boot on purpose: bind mounts don't survive
# a cold machine start (the volume keeps only the empty mountpoint), so this is NOT
# marker-guarded. Trade-off: `pnpm add` writes into the image copy on the ephemeral
# rootfs — preserved across suspend/resume, and restorable from package.json (pnpm
# install) after a rare cold start. Only the small source tree is copied to the
# volume (below), so the user's edits persist. Verified mount --bind works in-pod.
if [ -n "$ENV_NAME" ] && [ -d "/opt/env-templates/$ENV_NAME/node_modules" ]; then
  mkdir -p "$WORK/node_modules"
  chown dev:dev "$WORK/node_modules" 2>/dev/null || true
  if ! mountpoint -q "$WORK/node_modules"; then
    mount --bind "/opt/env-templates/$ENV_NAME/node_modules" "$WORK/node_modules" \
      && echo "podbay: node_modules bind-mounted from template $ENV_NAME" \
      || echo "podbay: node_modules bind-mount FAILED"
  fi
fi

# ---- Boot health check (EVERY boot; background) ----
# The bind-mount above and the dev server are both best-effort, and their failures
# were SILENT: a failed bind left node_modules empty, `pnpm dev` died with
# "next: not found" inside ~/.podbay-dev.log, and the first symptom anyone saw was
# a dead preview URL (hit live on an f10c pod; 0audit "add a boot health check").
# This makes the failure LOUD and applies the documented remediation:
#   - dev script + EMPTY node_modules (bind failed/degraded) → `pnpm install`
#     (the workspace restore path already promised in the bind-mount comment above)
#   - dev script + :3000 silent after the grace window → record + log the failure
# Verdict lands in ~/.podbay-boot-health (json) — durable on the volume, readable
# by the owner, the agent, and any future cockpit surface. Non-fatal by design:
# health reporting must never break a boot that would otherwise have limped along.
BOOT_HEALTH=/home/dev/.podbay-boot-health
boot_health_check() {
  local has_dev="no" nm_state="n/a" dev_state="n/a" remediation="none"
  # Wait for the first-boot setup (source copy + install + dev start) to finish BEFORE
  # inspecting the workspace. This check races the background setup phase; if it ran first it
  # saw no package.json yet, decided has_dev=no, and skipped the node_modules restore entirely —
  # so a Docker bind-mount failure (no CAP_SYS_ADMIN) left node_modules empty and the dev server
  # dead on "next: not found", unhealed (found dogfooding 2026-08-13). The check must never delay
  # the boot path, so this waits in the background (boot_health_check runs with &).
  local setup_waited=0
  while [ -f "$SETUP_RUNNING" ] && [ ! -f "$SETUP_MARKER" ] && [ "$setup_waited" -lt 900 ]; do
    sleep 10; setup_waited=$((setup_waited + 10))
  done
  if [ -f "$WORK/package.json" ] && su dev -c "jq -e '.scripts.dev // empty' '$WORK/package.json'" >/dev/null 2>&1; then
    has_dev="yes"
    if [ -d "$WORK/node_modules" ] && [ -n "$(ls -A "$WORK/node_modules" 2>/dev/null | head -1)" ]; then
      nm_state="present"
    else
      nm_state="EMPTY"
      echo "podbay: BOOT HEALTH: node_modules is empty with a dev script present — running pnpm install (restore path)"
      remediation="pnpm-install"
      su - dev -c "cd '$WORK' && pnpm install >> '$DEV_LOG' 2>&1" \
        && { nm_state="restored"; start_dev_server; } \
        || echo "podbay: BOOT HEALTH: pnpm install restore FAILED — see $DEV_LOG"
    fi
    # Grace window for the dev server to answer; Next cold-start on a pod is slow.
    local waited=0
    while [ "$waited" -lt 120 ]; do
      if curl -sf -o /dev/null --max-time 2 http://localhost:3000 2>/dev/null; then
        dev_state="up"
        break
      fi
      sleep 5; waited=$((waited + 5))
    done
    if [ "$dev_state" != "up" ]; then
      dev_state="DOWN"
      echo "podbay: BOOT HEALTH: dev server did NOT answer on :3000 within ${waited}s — see $DEV_LOG (last lines follow)"
      tail -5 "$DEV_LOG" 2>/dev/null | sed 's/^/podbay:   /' || true
    fi
  fi
  printf '{"at":"%s","env":"%s","devScript":"%s","nodeModules":"%s","devServer":"%s","remediation":"%s"}\n' \
    "$(date -Is)" "$ENV_NAME" "$has_dev" "$nm_state" "$dev_state" "$remediation" > "$BOOT_HEALTH"
  chown dev:dev "$BOOT_HEALTH" 2>/dev/null || true
}
# Background: the check WAITS (up to ~2min) and must never delay the boot path.
boot_health_check &

# ---- Local Postgres: a ready per-pod DB (data on the volume; every boot) ----
# Most projects want a database, so every pod gets a local Postgres. Data lives on
# the persistent volume (~/.pgdata) so it survives suspend/resume; runs as `dev`. This
# is NON-FATAL by design — a Postgres hiccup must never block pod boot. The default
# DATABASE_URL (set in secrets-load.sh) points here; a user secret overrides it.
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)
if [ -n "$PGBIN" ]; then
  PGDATA=/home/dev/.pgdata
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    su dev -c "'$PGBIN/initdb' -D '$PGDATA' -U dev --auth=trust" >/dev/null 2>&1 \
      && echo "podbay: postgres cluster initialized" || echo "podbay: postgres initdb FAILED"
  fi
  if [ -s "$PGDATA/PG_VERSION" ] && ! su dev -c "'$PGBIN/pg_ctl' -D '$PGDATA' status" >/dev/null 2>&1; then
    su dev -c "'$PGBIN/pg_ctl' -D '$PGDATA' -l /home/dev/.pglog -o '-c listen_addresses=localhost -k /tmp' -w -t 30 start" >/dev/null 2>&1 \
      && echo "podbay: postgres started" || echo "podbay: postgres start FAILED"
    # timeout: createdb -h localhost BLOCKS on a dead/half-up server; without the
    # cap a failed postgres start hangs init.sh forever → the agent never serves
    # (found on the systemd-based Incus image, where a stray default cluster held
    # :5432; harmless-but-latent on Fly). A missing app DB never blocks boot.
    timeout 15 su dev -c "'$PGBIN/createdb' -h localhost app" 2>/dev/null || true
  fi
fi

# Wake path: ~/work is already populated (setup ran on a prior boot), so bring the
# preview back up now. First boot starts it from the background phase after the copy.
# Codex skills on EVERY boot (see translate_codex_skills): heals a runtime-added codex and
# carries env skill updates onto existing pods. Self-gating; a no-op on non-codex pods.
translate_codex_skills

if [ -f "$SETUP_MARKER" ]; then start_dev_server; run_startup_commands; fi

# ---- Background phase: repo clone + env setup (run-once, non-blocking) ----
if [ -f "$SPEC" ] && [ ! -f "$SETUP_MARKER" ]; then
  REPO_URL=$(python3 -c 'import json; r=json.load(open("/etc/podbay/pod-spec.json")).get("repo") or {}; print(r.get("url",""))' 2>/dev/null || true)
  REPO_REF=$(python3 -c 'import json; r=json.load(open("/etc/podbay/pod-spec.json")).get("repo") or {}; print(r.get("ref") or "")' 2>/dev/null || true)
  SETUP=$(python3 -c 'import json; print("\n".join(json.load(open("/etc/podbay/pod-spec.json")).get("setup",[])))' 2>/dev/null || true)
  # BYO-repo: the user's chosen "owner/name" (docs/plans/byo-repo-plan.md). When set it
  # IS the workspace — clone it instead of the env template. The clone token is a
  # reserved secret; read it from secrets.env in a subshell so it never lands in
  # this shell's env, and clone via a git CREDENTIAL STORE (not a token-in-URL) so
  # it never appears in the setup log or `ps`.
  GH_REPO=$(python3 -c 'import json; print(json.load(open("/etc/podbay/pod-spec.json")).get("githubRepo") or "")' 2>/dev/null || true)

  # Mark setup as in-flight SYNCHRONOUSLY, before forking the background phase.
  # The agent boot command (boot.ts) blocks on this: it waits for $SETUP_MARKER
  # only when this sentinel exists, so the agent never opens a half-copied ~/work
  # (which sent it into a destructive "the workspace is broken" fixing session).
  # pod-agent runs podbay-init to completion before building the boot command, so
  # this touch always wins the race. Both markers live on the persistent volume,
  # so on wake both are present and the agent starts immediately (no wait).
  touch "$SETUP_RUNNING"
  chown dev:dev "$SETUP_RUNNING" 2>/dev/null || true

  (
    set +e
    echo "podbay: setup starting $(date -Is)"
    # BYO-repo FIRST: the user's repo replaces the env template as ~/work.
    if [ -n "$GH_REPO" ] && [ ! -d "$WORK/.git" ]; then
      GH_TOKEN=$( set -a; . /etc/podbay/secrets.env 2>/dev/null; printf '%s' "${PODBAY_GH_CLONE_TOKEN:-}" )
      if [ -n "$GH_TOKEN" ]; then
        echo "podbay: cloning your GitHub repo $GH_REPO"
        # Credential store (dev-owned, 0600) so git authenticates WITHOUT the token
        # in any URL/log; then clone with a plain URL. Also enables the agent's pushes.
        printf 'https://x-access-token:%s@github.com\n' "$GH_TOKEN" > /home/dev/.git-credentials
        chown dev:dev /home/dev/.git-credentials; chmod 600 /home/dev/.git-credentials
        su - dev -c "git config --global credential.helper store" 2>/dev/null || true
        # Also log `gh` in with the same token. The cockpit's GitHub status queries
        # `gh api user`, so WITHOUT this a BYO pod whose git auth works perfectly still
        # shows "not connected" — and the agent has no `gh` CLI for PRs/issues. Piped
        # (never on argv) and best-effort: a gh failure must not fail the clone.
        printf '%s' "$GH_TOKEN" | su - dev -c "gh auth login --with-token" 2>/dev/null \
          && su - dev -c "gh auth setup-git --hostname github.com" 2>/dev/null \
          || echo "podbay: gh auth login (BYO) failed — git credentials still active"
        su - dev -c "git clone --depth 1 'https://github.com/${GH_REPO}.git' '$WORK/.podbay-clone'" \
          && su - dev -c "cp -a '$WORK/.podbay-clone/.' '$WORK/' && rm -rf '$WORK/.podbay-clone'" \
          || echo "podbay: BYO repo clone FAILED"
      else
        echo "podbay: githubRepo set but no clone token — skipping BYO clone"
      fi
    # Prebuilt template baked into the image (deps installed at image build):
    # a local copy beats a network clone + install by minutes.
    elif [ -n "$ENV_NAME" ] && [ -d "/opt/env-templates/$ENV_NAME" ] && [ ! -e "$WORK/package.json" ]; then
      # Copy the SOURCE tree only (tens of files) — node_modules is bind-mounted
      # above, not copied, and .next is regenerated by the dev server. tar streams
      # the small file set in well under a second. chown skips node_modules so it
      # doesn't recurse into the 20k-file mount (already dev-owned from the image).
      echo "podbay: copying prebuilt template $ENV_NAME (source; node_modules bind-mounted)"
      ( cd "/opt/env-templates/$ENV_NAME" && tar cf - --exclude=node_modules --exclude=.next . ) \
        | ( cd "$WORK" && tar xf - ) \
        && find "$WORK" -mindepth 1 -maxdepth 1 ! -name node_modules -exec chown -R dev:dev {} + \
        || echo "podbay: template copy FAILED"
    # Otherwise clone via a temp dir so it works regardless of what's already
    # in ~/work (the .claude layer, or files the user created before setup landed).
    elif [ -n "$REPO_URL" ] && [ ! -d "$WORK/.git" ]; then
      CLONE_ARGS=(--depth 1)
      [ -n "$REPO_REF" ] && CLONE_ARGS+=(--branch "$REPO_REF")
      su - dev -c "git clone ${CLONE_ARGS[*]} '$REPO_URL' '$WORK/.podbay-clone'" \
        && su - dev -c "cp -a '$WORK/.podbay-clone/.' '$WORK/' && rm -rf '$WORK/.podbay-clone'" \
        || echo "podbay: repo clone FAILED"
    fi
    # Chown ~/work ITSELF to dev. The template `tar cf - . | tar xf -` above extracts
    # the archive's "." entry, which carries the root-owned template dir's ownership
    # and re-roots ~/work — and the `find -mindepth 1` only fixes the CONTENTS, not
    # the dir. A root-owned ~/work blocks the dev server (can't mkdir .next/) and the
    # agent's writes (PLAN.md, jobs). This is the real "root-owned ~/work" cause;
    # unrelated to the 9p→block change (that fixed a different, mount-timing bug).
    chown dev:dev "$WORK" 2>/dev/null || true
    # BYO skill-collision dedup: the repo's OWN skills WIN. If the cloned repo
    # ships a skill whose name matches one we seeded at user level (~/.claude), drop
    # OUR copy so the repo's version is the only one — we never override the
    # maintainer's own agent config. (Runs post-clone; a no-op for non-BYO, where
    # our layer lives in ~/work/.claude, not ~/.claude.)
    if [ -n "$GH_REPO" ] && [ -d "$WORK/.claude/skills" ]; then
      for repo_skill in "$WORK/.claude/skills"/*/; do
        [ -d "$repo_skill" ] || continue
        name=$(basename "$repo_skill")
        if [ -e "/home/dev/.claude/skills/$name" ]; then
          rm -rf "/home/dev/.claude/skills/$name"
          echo "podbay: repo ships skill '$name' — deferring to it (removed our copy)"
        fi
      done
    fi
    if [ -n "$SETUP" ]; then
      su - dev -c "cd '$WORK' && $SETUP" || echo "podbay: setup step FAILED"
    fi
    touch "$SETUP_MARKER"
    chown dev:dev "$SETUP_MARKER" 2>/dev/null || true
    echo "podbay: setup complete $(date -Is)"
    # Source is now in place — bring the preview up (first boot; wake uses the
    # call after the postgres block above).
    start_dev_server
    run_startup_commands
  ) >> "$SETUP_LOG" 2>&1 &
  chown dev:dev "$SETUP_LOG" 2>/dev/null || true
  echo "podbay: setup running in background (log: $SETUP_LOG)"
fi
