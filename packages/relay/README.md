# Podbay Relay

The Podbay relay lets your pods reach websites through your network instead of
a datacenter. This helps with sites that block cloud IPs. For sites you choose,
the relay can also use a separate browser session that you sign into.

One relay handles two kinds of traffic:

| mode | what the pod gets | used by |
|---|---|---|
| **fetch** | a page loaded by this machine, optionally with a session you provided | the agent's `podbay fetch get` command |
| **tunnel** | a proxy connection through your IP, without your cookies | crawlers, scripts, Playwright, and other tools that load pages themselves |

The tunnel lets a pod run a real browser while the connection comes from your
network. Pods receive it through `$PODBAY_RELAY_PROXY`. It **fails closed**: if
the relay is not running, those connections are refused instead of quietly
leaving from the datacenter.

```bash
# Your pod prints the exact command, pinned to a version and pairing code:
npx @podbay/relay@<version> start --code <code> --accept
```

Once started, the relay runs in the background and handles both modes.

## What it does — and what it does not do

- **Public pages are clean by default.** They load in a fresh browser without
  your cookies or accounts.
- **Signed-in access is explicit.** `relay login <domain>` opens a browser so
  you can sign in. Only that domain may use the saved session. The relay returns
  page content, never cookies, credentials, or session tokens.
- **The tunnel shares your IP, not your accounts.** Tools using the proxy get a
  clean connection without your signed-in sessions.
- **Your private network stays blocked.** Pods cannot reach localhost, your LAN,
  private IPs, routers, or other internal services through the relay.
- **You stay in control.** `relay dashboard` shows activity and lets you pause a
  pod, block a site, revoke signed-in access, manage history, or stop the relay.
- **Requests are rate-limited per site**, so one pod cannot hammer a source
  through your connection.

## Commands

| command | description |
|---|---|
| `relay start --code <code> --gateway <url> --accept` | start the relay in the background |
| `relay login <domain>` | allow signed-in fetches for one domain |
| `relay dashboard` | open the local command center |
| `relay status` | show the relay, gateway, and signed-in site status |
| `relay stop` | stop it |
| `relay reset` | remove saved sessions, logins, and pairing |

## Trust

The relay stores browser sessions for sites you sign into, so treat it as
sensitive software. It is open source under Apache-2.0 and uses its own browser
profile; it never touches your everyday browser, history, or cookies. Automating
a signed-in session may violate a site's terms, and the account risk is yours.

## Local command center and history

`relay dashboard` shows the connection state, recent activity, and access
controls. While the relay runs, the dashboard is live. When stopped, it shows
saved history in read-only mode. The CLI always prints its local URL, so it also
works on headless machines without `xdg-open`.

Activity is stored in owner-only, daily files under `~/.podbay/relay/events`.
Events include the pod ID when available, mode, sanitized target, timing,
outcome, HTTP status, signed-in use, and tunnel byte counts. History is kept for
30 days by default; the dashboard offers 7, 30, or 90 days and enforces a
storage limit.

Before an event is written, URLs are stripped of usernames, passwords, query
strings, and fragments. Logs never include cookies, authorization headers,
browser storage, request or response bodies, or tunnel content. Detailed
history and exports stay on your machine; Podbay receives only coarse,
domain-level telemetry. Clearing history does not clear pairing, sessions,
paused pods, or blocked sites.

## Running headless

Running the relay on a NAS, Raspberry Pi, or another always-on machine? See
[FAQ.md](FAQ.md) for help with missing `npx`, starting at boot, and opening the
dashboard remotely.
