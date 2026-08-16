# First-party skill (authored by podbay)
source: podbay
license: proprietary
authored: 2026-07-22
notes: |
  The monitoring core for the morning-ops-robot / operations bot: snapshot → diff →
  threshold → dedupe → cooldown → recovery. The skills survey found no strong,
  prompt-only generic equivalent (candidates were product-coupled — Grafana, or
  domain "anomaly-detection" prompt-dumps). Alerts go to the OWNER under [alerting].
