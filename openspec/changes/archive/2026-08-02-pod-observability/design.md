# Design: pod observability, incident log, and notifications

## The event taxonomy — what happens in a pod's life, and who hears about it

Every row is a thing that can happen to a pod. Columns: is it **planned** (the owner or an
admin asked for it) or unplanned; **severity**; how we **detect** it; and which channels it
reaches — **session** (the owner's Claude/Codex app, via the resume nudge — the PRIMARY owner
channel), **cockpit** (the durable record), **admin** (fleet dashboard), **TG** (ops bot).
"Today" = what exists now. Restart-causing incidents reach the **session**; everything is also
recorded in the cockpit. (The tables below use the Cockpit column for the record; the session
delivery is described under Notifications.)

### Planned lifecycle (info — a timeline, not an alarm)

| Event | Detect | Cockpit | Admin | TG | Today |
|---|---|---|---|---|---|
| Provisioning / building | status | ✓ | ✓ | — | status only |
| Ready / running | boot | ✓ | ✓ | — | `running` event |
| Idle → sleeping | idle policy | ✓ | ✓ | — | `sleeping` event |
| Resumed / woke | wake | ✓ | ✓ | — | partial |
| Admin **update** (image) | control-plane | ✓ short notice | ✓ | — | `updated`, not shown to user |
| **Resize** (s→m→l) | control-plane | ✓ | ✓ | — | `resized` event |
| Agent added / RC toggled | control-plane | ✓ | ✓ | — | events ✓ |
| Destroyed | control-plane | — | ✓ | — | `destroyed` event |

The rule the owner asked for: **any restart the owner did not personally cause SHALL be
explained to them** — including an admin update. A planned admin action still surfaces in the
cockpit with a one-line "what/why" so an unexpected reboot is never a mystery.

### Unplanned incidents (warn / critical — the point of this change)

| Incident | Detect | Sev | Cockpit | Admin | TG | Today |
|---|---|---|---|---|---|---|
| **Agent OOM-killed** | kernel log | critical | ✓ record (+ session notice) | ✓ | ✓ | ✗ **new** |
| **Child OOM-killed** (build / Chromium) | kernel log | warn | ✓ | ✓ | if repeated | ✗ **new** |
| **OOM loop** (≥N in a window) | kernel log count | critical | ✓ record (+ escalated session notice) | ✓ | ✓ | ✗ **new** |
| Memory pressure (near limit, no kill yet) | `MemAvailable` | warn | ✓ | — | — | ✗ **new** |
| Agent crash / respawn (non-OOM) | watchdog | warn | ✓ | if repeated | — | `pod_repaired` (no cause) |
| **Agent stuck** (respawn capped, gave up) | repair-policy | critical | ✓ "your agent is stuck" | ✓ | ✓ | partial |
| Disk critical / low | health-check | crit / warn | ✓ | ✓ | crit | issue exists, not alerted |
| Session-dead / scheduler-dead | health-check | critical | ✓ | ✓ | ✓ | issue exists |
| Codex runtime missing | health-check | warn | ✓ | ✓ | — | issue exists |
| Provision / build **failed** | status=error | critical | ✓ | ✓ | ✓ | `error` status/event |
| Update / resize **failed** | control-plane | critical | ✓ | ✓ | ✓ | `update_failed`/`resize_failed` |
| Wake / reconcile failure | provider error | warn | ✓ | ✓ | if persistent | partial |
| First-boot setup never finished | boot marker | warn | ✓ | ✓ | — | partial |

### Edge cases we must handle, not just log

- **OOM loop.** Repeated kills → do not spam (dedup, below); escalate the message from
  "restarted once" to "this keeps happening — resize".
- **Wedged pod** = agent dead AND repair capped. This is the worst state and must be
  loud (critical, TG) — the owner's pod is doing nothing and nobody knows.
- **No address / provider unreachable.** Distinguish a transient blip (retry, quiet) from a
  persistent failure (alert) — the reconcile sweep already sees this; give it a threshold.
- **The victim matters.** An OOM that kills a throwaway build subprocess (agent survives) is
  a *warning*; one that kills the agent or the app is *critical*. Parse the victim name.

## Detection mechanisms

- **OOM.** The pod-agent runs as root (systemd), so it can read the kernel log. A detector
  scans for `Out of memory: Killed process <pid> (<name>)` since the last scan, extracts the
  victim name (`next-server`, `chrome`, `node`, `claude`) and its RSS, and emits an
  `oom_killed` incident. If the victim is the agent (or its process group), correlate with a
  respawn and set the respawn's **cause = oom**.
- **Memory pressure.** Extend `computeIssues` (which today only knows disk) with a memory
  check on `MemAvailable/MemTotal` — `memory-critical` / `memory-low`, same shape as disk.
  This is the *early warning* before a kill.
- **Respawn cause.** The watchdog already respawns a dead agent; today the event carries no
  reason. Correlate the death with a recent OOM of that PID → `oom`; else `crash`/`hang`.
- **Planned actions.** Already emitted by the control-plane (`update_*`, `resize_*`); the
  change is to render them to the *owner*, not just the admin/event row.

## The log/observability layer

- **Persistence.** `pod_events` already exists and is the store. Add to each record:
  `severity` (info | warn | critical), a user-facing `message` (phrased as the problem/fact,
  not the check name), and an optional `action` (e.g. `{kind: "resize", to: "m"}`).
- **Cockpit — a new Activity tab.** A reverse-chronological timeline of the pod's events,
  plus a dismissible **incident banner** for a recent unplanned warn/critical. The banner
  RECOMMENDS the fix and **links to the resize/settings page** (one click to get there); it
  does not auto-resize (decided: recommend-only, but the link makes acting trivial).
- **Admin — a fleet incidents view.** Recent incidents across all pods, worst-first; drill
  into a pod's full timeline. Reuses the fleet plumbing.
- **Doctor reports.** Persist the latest doctor report per pod (and on any critical
  incident, run it and attach it), linked from the timeline — so "what did the pod look like
  when it broke" is answerable after the fact, not only live.

## Notifications

**The owner's comms channel is the AGENT SESSION** (their Claude/Codex app on phone or
desktop), not the cockpit or any web UI — most owners never have the cockpit in front of
them. So the primary user notification is delivered IN the session; the cockpit/admin/TG are
the durable record and the admin channel.

### Owner — in the agent session, on resume (the primary path)

A restart-causing incident (agent OOM, crash, wedged) is delivered by ENRICHING a mechanism
that already exists: the greeter's **resume nudge**. Today, when the watchdog respawns a dead
agent, it resumes the conversation (Claude `--continue`, Codex `codex resume --last`) and
sends a nudge to make the agent re-orient. We attach the incident to that nudge:

> `Podbay system notice: this pod ran out of memory and your session was restarted. Tell the
> user in one line, and if it recurs, point them to resize the pod: <cockpit resize link>.`

Why this is derail-safe: there is **no live task to derail** — the restart already killed it,
and the agent is re-orienting anyway. The notice is the missing context about the gap, not an
interruption. Properties:

- **Attributed.** Phrased as a verbatim "Podbay system notice" the agent relays, so the user
  reads it as a platform fact, not the model guessing.
- **Works for both agents.** It rides the per-agent resume the greeter already does.
- **Deduped.** State the cause once per incident; on an OOM loop escalate the wording ("this
  keeps happening — resize") rather than repeating it every restart.
- **Carries a real link.** Any recommended action includes a **direct cockpit deep-link** so
  the fix is one click (see "The agent knows its pod" below).

Non-restart warnings (child OOM with the agent alive, memory-low, disk-low) are NOT injected
mid-task in v1 — that would derail active work, and we have not designed a safe idle-boundary
delivery yet (deferred). They live in the record (cockpit timeline) + admin + TG digest, and
may be mentioned on the next resume if one occurs.

### The agent knows its pod — so it can point the user

For the agent to hand the user a one-click link (resize, secrets, settings), it must know its
own pod's cockpit URLs. The pod spec (`/etc/podbay/pod-spec.json`, surfaced by the `podbay`
CLI) SHALL carry the pod's cockpit base and the deep-links that matter (resize/settings,
secrets), and `podbay info` SHALL show them — so both the resume nudge and the agent itself
can point the user precisely, rather than saying "go to the dashboard somewhere." This is a
general capability (useful well beyond incidents) but it is load-bearing for the resize
recommendation, so it is in scope here.

### Admin — dashboard + Telegram ops

The fleet view, plus **Telegram via a dedicated ops bot** — env `TELEGRAM_OPS_BOT_TOKEN` /
`TELEGRAM_OPS_CHAT_ID` (Fly secrets, never in the repo; separate from the growth/signup bot).
Generalizes `auth/notify.ts` into `notifyOps(text)`.

- **Dedup / rate-limit** (so an OOM loop is one alert, not fifty): ≤1 per `(pod,
  incidentType)` per window (e.g. 1 h); escalate wording on repeats.
- **TG thresholds (decided):** **critical** pages the ops channel immediately; **warnings** go
  into a **daily** digest. The owner's cockpit record shows both regardless.

## Severity model

- **info** — normal lifecycle (running, sleeping, planned update/resize). Timeline only.
- **warn** — recoverable / early warning (child OOM with agent alive, memory-low, disk-low,
  single crash-and-recovered). Cockpit + admin dashboard.
- **critical** — the owner's work is impacted or the pod is wedged (agent OOM, OOM loop,
  agent stuck, provision/update/resize failed, disk-critical, session-dead). Cockpit banner +
  admin + TG.

## Rollout

Detection lives in the **pod-agent** (kernel-log scan, memory check) → needs an **image
build + promote** to reach pods. The event model, cockpit Activity view, admin fleet view,
and Telegram sender are **web/gateway** changes → a deploy. Migration for the new
`pod_events` columns rides the gateway release (deploy gateway before web, as usual).

## Decisions (owner, 2026-08-01)

1. **Resize = recommend-only (text), no button** — but the recommendation carries a **direct
   cockpit link** so acting on it is one click. We don't auto-resize (it restarts the pod and
   costs more); we make the manual step trivial.
2. **Event-log retention = keep everything.** No aging-out; the full history is retained.
3. **TG = critical immediately + a daily digest for warnings.** A critical incident pages the
   ops channel at once; warnings are batched into a daily digest.
4. **Planned-action detail = short notice only.** "Podbay updated your pod and restarted it" —
   no changelog. Enough that the restart is never a mystery, without extra surface.
5. **The owner is notified IN THE AGENT SESSION** (their Claude/Codex app), not the cockpit —
   that is where they are. A restart-causing incident rides the greeter's existing resume
   nudge (derail-safe: the restart already killed the task); the cockpit is the durable record,
   not the primary alert. Non-restart warnings stay record/admin-only for v1 (safe
   idle-boundary injection is a later design).
6. **The agent knows its pod's cockpit URLs** (via the pod spec / `podbay` CLI), so any
   recommendation ("resize") is a real one-click link, not "go find the dashboard."
7. **Warn-digest cadence = daily.**

All decisions resolved.
