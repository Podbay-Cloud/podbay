# pb — the Podbay relay

`relay` runs a small relay on your own machine so a Podbay pod can reach the web
**from your network** instead of from a datacenter. Many sites block cloud IPs at the
edge; the relay lets your pod read them from your home address — and, only where you
choose, using sites you're signed into.

One command serves **two** things, and you never pick between them:

| | what the pod gets | used by |
|---|---|---|
| **fetch** | a page, fetched by this machine — optionally **as you** (your cookies) | the agent's `podbay fetch get` |
| **tunnel** | a proxy: your **IP**, with the live page/DOM intact (no cookies) | a crawler, a script, Playwright — anything that fetches its own way |

The tunnel is why a pod can run a real browser against a site that blocks datacenters:
the pod drives the browser (so JS challenges are solved) while the connection comes
from you. Pods have it pre-wired as `$PODBAY_RELAY_PROXY` and it **fails closed** —
with no relay running, those connections are refused rather than quietly leaving from
the datacenter.

```bash
# your pod will print the exact command, pinned to a version and pairing code:
npx @podbay/relay@<version> relay start --code <code> --accept
```

That's it — it runs in the background and serves fetches for your pods.

## What it does, and doesn't

- **Open by default, clean by default.** Once running, your pod can fetch the public
  web through it. Every fetch uses a **fresh, cookie-less browser** — your residential
  IP, but none of your accounts.
- **Fetch a site *as you* only when you say so.** `relay login <site>` opens a
  browser, you sign in once, and from then on **that site** is fetched with your
  session. Everything else stays clean. A pod can never read an account you didn't
  explicitly lend.
- **Never your private network.** It refuses localhost, your LAN, and private IPs — a
  pod cannot make your machine reach your own router or internal services.
- **Never your session, only pages.** It returns page content to the pod, never a
  cookie or a login.
- **The tunnel carries your IP, never your accounts.** Sites reached through the proxy
  get a clean context — "as you" stays a `relay login` thing, and the tunnel does not
  replicate it.
- **You can inspect and narrow it.** `relay dashboard` opens a loopback-only command
  center with live state, chronological activity, per-pod and per-site summaries, and
  explicit outcomes (site refusal, owner block, safety block, rate limit, or network
  error). Pause one pod, block one site, revoke a site's signed-in use, export or clear
  history, change retention, or stop the whole relay there.
- **Rate-limited per site**, so a misbehaving pod can't hammer a source in your name.

## Commands

| command | what |
|---|---|
| `relay start --code <c> --gateway <url> --accept` | run the relay in the background |
| `relay login <domain>` | let one site be fetched as you |
| `relay dashboard` | open the local command center; show saved history read-only when stopped |
| `relay status` | is it running, and what's lent |
| `relay stop` | stop it |
| `relay reset` | wipe its saved sessions |

## Trust

This program holds the browser sessions you sign into and fetches on your behalf, so
it is **open source (Apache-2.0)** — read exactly what it does before you run it. It
uses a **separate browser profile it owns**; your everyday browser, history and
cookies are never touched. Automating a signed-in session may breach a site's terms,
and the account at risk is yours.

## Local command center and history

Return to the command center to verify the relay is connected, see which pod borrowed
your connection, diagnose a refusal, review signed-in use, or narrow access. While the
daemon runs it serves live state and controls. When stopped, the same command serves
retained history read-only. The CLI always prints the URL; opening a browser is
best-effort, so it remains usable on headless machines without `xdg-open`.

Detailed events stay under `~/.podbay/relay/events` in owner-only, day-partitioned
files. They include the gateway-attributed pod id when available, mode, sanitized
target, timing, outcome, status, signed-in use, and tunnel bytes. The default retention
is 30 days; the command center offers 7, 30, or 90 days and a hard disk ceiling.

Before disk write, fetch URLs lose usernames, passwords, query strings, and fragments.
Cookies, authorization headers, browser storage, request/response bodies, and tunnel
content are never event fields. Podbay does not receive the local path-level history or
exports; hosted telemetry remains coarse and domain-level. Clearing history does not
clear pairing, sessions, paused pods, or blocked sites.
