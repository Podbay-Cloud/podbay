## 1. Mechanism
- [x] 1.1 control-plane `maintenanceWakePods(dormantMs, maxPerSweep, now)`; off when dormantMs<=0
- [x] 1.2 Tests: dormant wakes, fresh skipped, lastActiveAt reset, cap, keepAwake skip, disabled

## 2. Wire (opt-in)
- [x] 2.1 gateway config + `sweepMaintenance` on the timer; `PODBAY_MAINTENANCE_DORMANT_DAYS`
- [x] 2.2 pnpm -r build + suites green; leak-scan
- [x] 2.3 Verified Claude Code refreshes only on activity (not on idle resume); maintenance wake now
  forces a refresh via a tiny `claude -p` once the woken pod is reachable; unit-tested.
