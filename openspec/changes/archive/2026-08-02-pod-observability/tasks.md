# Tasks: pod observability

> **Status 2026-08-02:** FEATURE-COMPLETE. Detection → incident model → cockpit record → owner banner
> → Telegram shipped + verified end-to-end (owner-confirmed). Two detection bugs fixed via the verify
> (`dmesg -t` stripped ktime; memcg regex). Then landed in one sweep: §6 admin fleet-incidents view
> (deployed), §7 daily warn-digest (gateway, timer running), §2 doctor snapshot on critical incidents
> (attached to the event jsonb meta — no migration — + shown in /admin/incidents), and §3 the greeter
> in-session OOM nudge (shipped in image `d505dbe7d467`, **verified live** on moderate-peacock-59a7 —
> greeter typed the "Podbay system notice"). Severity is classified at READ-TIME (`classifyEvent`),
> not persisted columns — §2 migration skipped by design. **DONE + VERIFIED — ready to archive.**
> Known v1 gap: the greeter nudge is Claude-primary only (Codex resume path not yet enriched).

## 1. Detection (pod-agent — needs an image build to reach pods)
- [x] OOM detector: scan the kernel log since last-seen for `Out of memory: Killed process`,
      extract victim name + RSS, emit an `oom_killed` incident (victim, rss, memAvailable).
      (Fixed 2026-08-02: read dmesg WITHOUT `-t`; broadened regex for cgroup OOM lines.)
- [x] Memory health check in `computeIssues`: `memory-critical` / `memory-low` on
      `MemAvailable/MemTotal` (mirror the disk check).
- [x] Respawn cause: correlate a dead-agent respawn with a recent OOM → set `cause = oom` on the
      `pod_repaired` event.
- [x] Emit "agent stuck" as a distinct critical incident when repair-policy caps (`repair_gave_up`).

## 2. Event/incident model (control-plane + db)
- [ ] ~~Migration: add `severity`, `message`, `action` to `pod_events`.~~ SKIPPED — classified at
      read-time via `classifyEvent`, no persisted columns (simpler, recomputable after a fix).
- [x] `Incident` type + helpers: build a user-facing message + recommended action per event.
- [x] Classify existing events into the severity model (info/warn/critical).
- [x] Run doctor (read-only `check`) on a critical incident and ATTACH a compact snapshot to the
      event's jsonb meta (`attachDoctorIfCritical`) — the latest such snapshot per pod IS the frozen
      diagnostic; surfaced under each row in /admin/incidents. (No per-pod-row column; meta is enough.)

## 3. In-session delivery — the PRIMARY owner notification (pod-agent — needs image)
- [x] Enrich the greeter's **resume nudge**: when the restart was caused by an OOM, the nudge leads
      with an attributed "Podbay system notice: <cause>" + recommended action + cockpit link.
      `incident-nudge.ts` composer + `main.ts` wiring, 10 unit tests. Shipped in image `d505dbe7d467`.
      **VERIFIED live on moderate-peacock-59a7 (2026-08-02):** forced agent OOM → `resume_oom_attributed`
      → greeter typed "Podbay system notice: …" → `greeter_resume sent:true`. v1 is CLAUDE-primary only
      (the greeter that types the nudge is Claude-only); Codex resume goes through a different path and
      is NOT yet enriched — a known v1 gap. Also: process-OOM only (a full OOM-reboot clears dmesg).
- [x] Dedup: one notice per restart (the greeter types it once); escalated wording on a loop
      (≥2 agent OOMs in the window).
- [x] Only restart-causing incidents inject: attribution requires an actual agent OOM; memory-pressure
      warnings never trigger it.

## 4. The agent knows its pod (pod-agent + provider — needs image)
- [x] Add the pod's cockpit base + deep-links to the pod spec (`/etc/podbay/pod-spec.json`) and to
      `podbay info` (`cockpitUrl`). NOTE: an in-place update preserves the OLD spec, so already-running
      pods keep the old spec until re-provisioned — a fresh provision has it.

## 5. Cockpit — the durable record (apps/web)
- [x] Pod **Activity** tab: reverse-chronological event/incident timeline (`getPodActivity` +
      `event-timeline`, severity dots).
- [x] Incident **banner** on the pod page for a recent unplanned warn/critical (`IncidentBanner`,
      recommend-only, cockpit-scoped). Crash markers also drawn on the running-history bar.
- [x] Surface planned admin actions (update/resize) to the owner (details "Podbay activity" row).

## 6. Admin (apps/web)
- [x] Fleet **incidents** view: `/admin/incidents` — unplanned warn/critical across pods, worst-first,
      each row drilling into `/admin/pods/[id]`. DEPLOYED.
- [x] Per-pod drill-in (via the row link) + the doctor snapshot shown inline on each incident.

## 7. Notifications (Telegram ops)
- [x] Generalize `auth/notify.ts` → `notifyOps(text)` using `TELEGRAM_OPS_BOT_TOKEN` /
      `TELEGRAM_OPS_CHAT_ID` (Fly secrets; separate from the signup bot).
- [x] Dedup/rate-limit: ≤1 notification per `(pod, incidentType)` per window (`alertIfCritical`, 1h).
- [x] Critical incidents → immediate `notifyOps`; warnings → a **daily** digest (`buildWarnDigest` +
      a 24h gateway timer → `notifyOps`). DEPLOYED (gateway logs "warn digest every 86400000ms").

## 8. Ship
- [x] Set `TELEGRAM_OPS_BOT_TOKEN` / `TELEGRAM_OPS_CHAT_ID` as Fly secrets on the alerting app.
- [x] Image build + promote (pod-agent detection) — image `f80ae74` promoted on gateway + web.
- [x] Verify on a real pod: forced OOM → `oom_killed` → cockpit banner + crash marker + TG + dedup
      CONFIRMED (owner-verified), AND the session resume-notice confirmed on moderate-peacock-59a7
      (greeter typed the Podbay system notice). Fully verified end-to-end.

## Decisions (owner, 2026-08-01) — see design.md
- [x] Resize: **recommend-only** (text, no button).
- [x] TG: **critical immediate + warnings digest**.
- [x] Planned-action detail: **short notice only** (no changelog).
- [x] Retention: **keep everything** (no aging-out).
- [x] Banner on the **cockpit pod page** (session view, not a separate dashboard); agent-stdin
      injection deferred (derail risk).
- [x] Warn-digest cadence: **daily**.
