# First-party skill (authored by podbay)
source: podbay
license: proprietary
authored: 2026-07-28
survey: skills/registry.yaml
notes: |
  Written for the session-handoff-on-interrupt change. Update and Suspend restart the pod and kill
  the agent mid-task; `--continue` restores Claude's own transcript but carries nothing across
  agents, across windows, or to the human. This skill is the writing half — the control plane
  requests it before an owner-initiated interrupt, best-effort under a timeout.
  The first skill in the UNIVERSAL layer (which shipped rules/ only until now), so it applies to
  every pod regardless of environment, and reaches Codex through the existing AGENTS.md/skills
  translation. Deliberately prompt-only: no scripts, nothing to install, nothing image-bound.
