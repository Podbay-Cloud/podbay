FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive TERM=xterm-256color LANG=C.UTF-8 \
    DISABLE_AUTOUPDATER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git tmux vim nano jq unzip sudo openssh-client \
    ripgrep locales less htop qrencode \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (Claude Code runtime)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

# ttyd — web terminal
RUN curl -fsSL -o /usr/local/bin/ttyd \
    https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 \
    && chmod +x /usr/local/bin/ttyd

# Official Claude Code CLI (unmodified)
RUN npm install -g @anthropic-ai/claude-code

# Non-root user; home lives on the persistent volume (mounted at /home/dev)
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -s /bin/bash dev \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev

COPY qr /usr/local/bin/qr
COPY session /usr/local/bin/session
COPY auth-proxy.js /usr/local/bin/auth-proxy.js
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /usr/local/bin/qr /usr/local/bin/session

EXPOSE 8080
CMD ["/entrypoint.sh"]
