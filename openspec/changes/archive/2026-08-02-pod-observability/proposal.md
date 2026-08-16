# Pod observability: an incident log the user and admin can actually follow

## Why

A pod can restart the user's agent out from under them and nobody is told. Confirmed on
`dual-bear-fb14` (makore.app), 2026-08-01, straight from the pod's kernel log:

```
Out of memory: Killed process (next-server)  anon-rss:3.2GB      ← the Next.js server
Compositor invoked oom-killer ...                                 ← Chromium's compositor tipped it over
Out of memory: Killed process (next-server)  anon-rss:2.6GB
```

On a 4 GB (Small) pod, a Next.js build plus a Chromium screenshot exhausts memory, the
kernel OOM-killer fires, and the agent's session dies and resumes ("archived → Resuming").
The owner only found out by *noticing the session restart in the terminal*. Nothing
surfaced it — not to them, not to us.

The pod already emits lifecycle events (`running`, `sleeping`, `updated`, `resized`,
`pod_repaired`, `update_failed`, …) and runs health checks (`disk-critical`,
`session-dead`, `scheduler-dead`, `codex-runtime-missing`). But:

- **There is no memory/OOM detection at all** — health checks cover disk only.
- **`pod_repaired` never records WHY** — an OOM restart and a random crash look identical.
- **The cockpit has no log/timeline** — the events exist in the DB but the user cannot
  see their pod's history, so an unplanned restart is a mystery.
- **There is no incident alerting** — the only Telegram notification is a signup ping;
  admins have no fleet view of pods that are OOM-thrashing, wedged, or failing to build.
- **Doctor produces a report that is never persisted** — you can run it, but it leaves no
  trail to follow after the fact.

Net: unplanned incidents are invisible to the user, and admins fly blind across the fleet.

## What Changes

1. **Detect what we currently miss** — a memory/OOM detector (parse the kernel log for
   OOM-kills; a `MemAvailable` health check), and CAPTURE THE CAUSE of an agent respawn
   (OOM vs crash vs hang) instead of an unexplained blip.
2. **One incident/event model** — every lifecycle event and every issue becomes a typed,
   severity-tagged record with a plain-language message and, where relevant, a recommended
   action (e.g. "resize to Medium"). Persisted (extends the existing `pod_events`).
3. **Notify the owner where they actually are — in the agent session.** Most owners drive
   their pod from the Claude/Codex app, not the cockpit, so a restart-causing incident is
   delivered IN the session by enriching the greeter's existing resume nudge ("Podbay system
   notice: this pod ran out of memory and was restarted"). It's derail-safe because the restart
   already ended the task. A recommendation ("resize") carries a **direct cockpit link** — which
   means the agent needs to know its own pod's cockpit URLs (a general capability, in scope
   here). The **cockpit Activity view + timeline** is the durable record, not the primary alert.
4. **An admin fleet incident view + Telegram ops alerts** — deduped and severity-gated, via
   a dedicated ops bot, so a real problem pages someone and an OOM loop does not spam.
5. **Planned actions are surfaced too** — an admin update/resize/restart records what
   happened and shows the user (in the cockpit) what changed, so an unexpected restart is
   never unexplained, even when it was intentional.

The heavy lifting is DESIGN, not new infrastructure: `pod_events`, health checks, the
watchdog/repair loop, the Telegram sender (`auth/notify.ts`), the `/agent/input` inject
path, and the resize flow all already exist. This wires them into a coherent whole and
fills the detection gaps.

See `design.md` for the full event taxonomy (what we log, at what severity, to whom) and
the detection mechanisms. Open design questions are listed at the end of `design.md`.

## Scope (v1) and non-goals

**In:** OOM + memory pressure, agent crash/respawn with cause, respawn-capped ("agent
stuck"), disk, session/scheduler-dead, provision/build/update/resize failures, planned
admin actions; cockpit Activity view + banner; admin fleet incidents + Telegram ops alerts;
persisted doctor reports.

**Out (deferred, noted so they are choices not omissions):**
- **Mid-task in-session delivery of NON-restart warnings** (child OOM with the agent alive,
  memory-low, disk-low). Restart-causing incidents ride the resume nudge safely; a warning
  while the agent is mid-task would derail it, and a safe idle-boundary delivery is not yet
  designed. v1 keeps those in the record/admin/TG-digest and may mention them on the next
  resume.
- **Auto-remediation** (auto-resize). We RECOMMEND a resize with a one-click cockpit link; we
  do not spend the owner's money without consent.
- **A metrics/APM dashboard.** The admin Usage card already charts CPU/mem; this is about
  discrete incidents, not time-series.
