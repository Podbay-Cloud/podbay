---
name: watch-and-alert
description: Monitor a value or source over time and alert only on meaningful change. Use when a job watches metrics, prices, statuses, uptime, inventory, feeds, or any source for thresholds, spikes, drops, or state changes — snapshot, diff, apply thresholds, dedupe, cooldown, and announce recovery.
---

# Watch and Alert

The discipline for turning "keep an eye on X and tell me if something happens" into a reliable,
non-spammy monitor. Pair with `validate-data` (trust the input first) and `status-report` (write the
finding up). Alerts go to the OWNER under the `alerting` rule — never external recipients.

## The loop (every watch run)

1. **Read the current value** from the source (an API, a DB query via `sql-queries`, a page, a file).
   If the source is unreachable or the value is missing/malformed, that is itself a finding — record
   `source: unhealthy` and do NOT treat "no data" as "no change". Never bypass a block to get it.
2. **Load the last good snapshot** for this watch (the app stores it; keep one per watch key).
3. **Diff** current vs. last: absolute change, % change, and state transitions (up→down,
   ok→failing, in-stock→out).
4. **Apply the threshold** the job defined (e.g. ">5% drop", "any 5xx", "< 10 units", "status != 200").
   Below threshold → record the snapshot, no alert.
5. **Persist policy state**: on a crossing, only alert if it is NOT a duplicate of a still-firing
   alert (same watch key + condition) and the **cooldown** has elapsed since the last alert for this
   key. Otherwise update the existing alert silently.
6. **Announce recovery**: when a firing condition clears, resolve the alert and (if the job says so)
   send a short "recovered" note — a resolved alert is as useful as the firing one.
7. **Always store the new snapshot** so the next run diffs against reality.

## Thresholds — be specific, not "anomalous"

"Anomaly" is domain-specific; make the job state the exact condition. Prefer:
- **Absolute**: value crosses a fixed line (disk > 90%, cert expires < 14 days).
- **Relative**: change vs. last/baseline exceeds N% (traffic −40%, price +15%).
- **State**: a transition between named states (CI green→red, up→down).
- **Rate/count**: N occurrences in a window (>3 failed logins in 10 min).
State the direction that matters — a metric going UP and DOWN are usually different alerts.

## Anti-spam (the whole point)

- **Dedupe** on a stable key (watch id + condition), so one ongoing problem is ONE alert, updated —
  not one per run.
- **Cooldown**: a minimum quiet interval between repeat alerts for the same key (the job sets it;
  default generous — hourly, not per-run).
- **Flap guard**: require the condition to persist for N runs / a duration before firing, so a single
  noisy sample doesn't page.
- **Severity**: reserve immediate alerts for what genuinely can't wait; fold the rest into the
  morning digest.
- **Act or recommend**: only take an action automatically if the job explicitly allows it; otherwise
  alert with a recommended action and let the owner decide.

## Record the finding

Every run writes a finding (what was checked, current value, delta, whether it crossed, snapshot
stored). Crossings become alerts; everything else rolls up into the digest so the owner sees "watched
12 things, all nominal" — quiet success is a result too.
