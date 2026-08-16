#!/bin/bash
set -e

# Volume is mounted at /home/dev — make sure dev owns it and has a skeleton
chown dev:dev /home/dev
sudo -u dev bash -c '
  cd ~
  [ -f .bashrc ] || cp -r /etc/skel/. ~/
  mkdir -p ~/work
  grep -q "cd ~/work" .bashrc || echo "cd ~/work" >> .bashrc
  grep -q "podbay help" .bashrc || cat >> .bashrc <<"BRC"
echo "podbay help: run \"claude\" | QR for last link: Ctrl-b q | detach: Ctrl-b d"
BRC
'

# Pre-seed Claude Code config: skip theme/onboarding wizard AND pre-trust the
# workspace folder, so a fresh user sees exactly one thing: the auth link.
sudo -u dev bash -c '
  if [ ! -f ~/.claude.json ]; then
    cat > ~/.claude.json <<JSON
{
  "theme": "dark",
  "hasCompletedOnboarding": true,
  "autoUpdates": false,
  "projects": {
    "/home/dev/work": {
      "hasTrustDialogAccepted": true,
      "hasCompletedProjectOnboarding": true
    }
  }
}
JSON
  fi
'

# tmux: mouse OFF so browser-native text selection/copy works (tmux mouse mode
# steals drag-select into its internal buffer — clipboard gets nothing)
sudo -u dev bash -c 'cat > ~/.tmux.conf <<EOF
set -g default-terminal "tmux-256color"
set -sg escape-time 10
set -g history-limit 50000
set -g allow-passthrough on
set -g focus-events on
set -g assume-paste-time 0
set -g status-style bg=colour236,fg=colour250
set -g status-left "#[bold] podbay-smoke "
bind q run-shell "tmux split-window -l 18 /usr/local/bin/qr"
EOF'

# Warm the page cache so the first `claude` start is fast
sudo -u dev bash -c 'claude --version >/dev/null 2>&1 || true' &

# ttyd bound to loopback with NO auth (auth is done by the cookie proxy in front —
# HTTP Basic Auth breaks WebSocket upgrades on mobile browsers).
ttyd -i 127.0.0.1 -p 7681 -W \
  -t titleFixed="podbay smoke" -t 'fontSize=18' -t 'fontFamily=Menlo, Consolas, monospace' \
  sudo -u dev -H /usr/local/bin/session &

# Public front door: cookie-session auth, proxies HTTP + WS to ttyd.
: "${TTYD_PASS:?TTYD_PASS secret not set}"
exec node /usr/local/bin/auth-proxy.js
