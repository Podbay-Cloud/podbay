## Context

From the audit (file:line):
- `agentStates()` builds each agent's health at `server.ts:1820-1835`. `authed`/`loginExpired` come
  from `credentialState` (file field only — `signals.ts:38-53`). `rcActive` for claude is
  `Boolean(this.agentSessionUrls.get(id) ?? this.lastSessionUrl)` (`server.ts:1826-1829`) — a sticky
  "we once captured a session URL", never re-evaluated for liveness.
- `rcActive` truth is only ever *set* during a greeter run (`greeter.ts:501-517`); the bridge id lives
  in `sessionStateFromDisk().url` (`signals.ts:295,330-332`) which reads `~/.claude/sessions/<pid>.json`
  for the ALIVE pid — so a fresh read IS a live-ish signal, but the healthz path caches instead.
- No pane markers exist for the CLI's auth-failure output (grep for "login expired"/"worker_auth"/"run
  /login" → nothing). `atBlockingGate` (`pane.ts:29`) covers menus, not the "Login expired" line.
- RC re-establishment only happens via the greeter, armed at boot + on a suspend/resume gap
  (`startResumeWatch`, `server.ts` resume wiring) — never on a mid-session re-login or a bridge death.
- The per-tick loop already captures the pane (`server.ts:2028`) and now runs the menu-watchdog — the
  natural home for a sibling fail-state check.

## Goals / Non-Goals

**Goals:**
- The pod detects auth/RC failure from LIVE signals (terminal + current bridge), so a mid-session
  failure is never invisible or reported as healthy.
- The pod auto-recovers the recoverable failure (RC dead while login valid → re-run `/remote-control`),
  including right after a re-login.
- What the pod cannot fix (a login needing the owner's browser OAuth) is surfaced immediately, not
  guessed at or auto-attempted.
- `rcActive` tells the truth (live), so cockpit/doctor stop lying.

**Non-Goals:**
- Auto-performing the OAuth `/login` (needs the owner's browser — can't and shouldn't automate).
- Preventing the Anthropic-side token expiry itself (server-side; out of our control — keep-fresh
  §2 + warn is the prevention lever, already specced under agent-login-resilience).
- Codex RC beyond what exists (its daemon self-heal + `codexRcActive` already live-ish; extend only
  the shared detection).

## Decisions

**D1 — Live auth-failure detection from the pane, debounced.**
Add auth-failure markers (shared, testable): `/login expired/i`, `/please run \/login/i`,
`/worker_auth_expired/i`, the RC "signed out … sign in again" message. In the per-tick fail-state
check, if an agent's pane matches one AND has been static for a short debounce (reuse the
menu-watchdog's paneHash/static-ticks so a transient self-heal isn't flagged), mark that agent
`needsReauth` on healthz — INDEPENDENT of `credentialState.expired`. `loginExpired` remains the
file-hard-expiry signal; `needsReauth` is the live one. Either raises the cockpit/doctor issue.
- *Why not replace loginExpired:* the file field is still meaningful (a genuinely dead refresh token);
  the live signal is additive and catches the refresh-*failure* case the file misses.

**D2 — `rcActive` becomes a live check.**
Re-derive RC liveness each healthz from the CURRENT bridge state — `sessionStateFromDisk().url` for
the alive pid (fresh read, `signals.ts:330`), plus the RC-dead pane markers — rather than the sticky
captured-URL boolean. Keep the captured `sessionUrl` for the "Open in Claude" link, but do not equate
"we have a URL" with "RC is alive". Codex keeps `codexRcActive` (already process-derived).
- *Alternative:* ping the bridge — rejected: the disk/pane signals are already there and cheap; no new
  dependency.

**D3 — Auto-restore RC when authed-but-RC-dead.**
In the per-tick fail-state check: if the agent is authed (creds valid, not `needsReauth`) AND RC is
live-dead (D2 false) AND no greeter is currently running for it, re-run the greeter's RC-only step
(the existing `reenableRemoteControl` path, which already exists for resume) — bounded with a
per-window attempt cap + backoff so a genuinely-unpairable pod doesn't loop. This covers BOTH the
mid-session bridge death AND the post-re-login case (once `/login` succeeds, creds go valid, RC reads
dead → auto-restore fires).
- *Guard against fighting a real login:* only fire when authed AND not `needsReauth` AND not at a
  menu (the menu-watchdog owns those) — so we never re-run RC into a logged-out or mid-login agent
  (this is why D1's live-auth signal must gate D3).

**D4 — Surface the unrecoverable honestly.**
`needsReauth` (D1) raises an `agent-needs-reauth` issue (warn, agent-scoped, not fixable-by-us) → the
cockpit shows "signed out — reconnect" and doctor reports it. The existing Reconnect action handles it
(wipe + respawn into /login, then the menu-watchdog drives the menu and D3 auto-restores RC). So the
owner's ONLY manual step is the browser OAuth itself.

## Risks / Trade-offs

- **[Auto-restoring RC disrupts a live session]** → RC re-enable is the same idempotent greeter step
  used on every resume today; gate on authed + not-at-menu + not-already-running + a static-dead
  debounce, so it only fires on a genuinely dead bridge, capped.
- **[False auth-failure from stale pane scrollback]** → the "Login expired" line could linger in
  scrollback after a fix; require static-for-N-ticks AND re-confirm on the CURRENT pane tail, and
  clear `needsReauth` the moment creds read valid + RC restores.
- **[Marker drift on a CLI update]** → same tripwire as the menu-watchdog: centralize the markers; an
  unrecognized-but-stuck auth state still surfaces via the RC-dead + not-progressing path.
- **[Codex]** → codex auth-failure is not reliably pane-scrapable; rely on its file expiry + daemon
  self-heal, stated explicitly.

## Open Questions

- **Auto-restore aggressiveness (the real fork for velsa):** re-run `/remote-control` automatically the
  moment RC reads dead-while-authed, or only after a debounce / only once then surface? Leaning:
  auto-restore with a cap of ~3 attempts + backoff, then surface "couldn't restore remote control" —
  never silent, never infinite.
- **Debounce N** for the live auth-failure marker (avoid flagging a 1-tick transient) — start ~2 ticks.
- Should `needsReauth` also feed the proactive keepalive-failure fault from agent-login-resilience D2
  (they're the same "login is broken while running" family)?
