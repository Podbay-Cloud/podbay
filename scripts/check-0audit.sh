#!/usr/bin/env bash
# 0audit hygiene guard — keeps 0audit.md a LIVING register of CURRENTLY-TRUE items,
# not a changelog. It bloated to 1326 lines once (2026-08-07 compaction) because agents
# kept marking items FIXED/struck-through INLINE instead of deleting them. Prevent that:
#
#   • Fixed something? DELETE its line — git history preserves it. Do NOT strike it
#     through (~~…~~) or leave a "**FIXED**" marker in an active section.
#   • A genuinely notable ship gets ONE line in the "## Recently shipped" breadcrumb (capped).
#   • The whole file stays under a ceiling; past it, compact.
#
# Standalone:  scripts/check-0audit.sh [path]     (default 0audit.md)
# Wired into:  scripts/git-hooks/pre-push          (checks the PUSHED version)
# Bypass:      git push --no-verify                (emergencies only)
set -uo pipefail
F="${1:-0audit.md}"
[ -f "$F" ] || exit 0
CEIL=250
BREADCRUMB_MAX=15

fail() { printf '%s\n' "$@" >&2; exit 1; }

total=$(wc -l < "$F")

# Everything above "## Recently shipped" is the ACTIVE register; the breadcrumb list
# below is the ONLY place a shipped item may be named.
split=$(grep -nE '^## Recently shipped' "$F" | head -1 | cut -d: -f1)
if [ -n "$split" ]; then
  active=$(sed -n "1,$((split-1))p" "$F")
  breadcrumb_lines=$(sed -n "${split},\$p" "$F" | grep -cE '^[[:space:]]*- ')
else
  active=$(cat "$F")
  breadcrumb_lines=0
fi

# 1) strikethrough anywhere = a done item left in the register
if grep -q '~~' "$F"; then
  fail "" \
"  ⛔ 0audit.md uses strikethrough (~~…~~) — that marks something DONE." \
"     0audit is a LIVING register: DELETE the fixed line (git history keeps it)," \
"     or add ONE breadcrumb line under '## Recently shipped'. Don't strike items out." \
"     offending:" \
"$(grep -nE '~~' "$F" | head -5 | sed 's/^/       /')" ""
fi

# 2) a done-status marker LEADING a bullet in an active section
badmarks=$(printf '%s\n' "$active" | grep -nE '^[[:space:]]*-[[:space:]]+.*(\*\*(FIXED|SHIPPED|DEPLOYED|DONE)|✅|—[[:space:]]+(FIXED|SHIPPED|DEPLOYED))' || true)
if [ -n "$badmarks" ]; then
  fail "" \
"  ⛔ 0audit.md marks an item FIXED/SHIPPED/DEPLOYED inline in an active section." \
"     DELETE it (git preserves history) or move ONE line to '## Recently shipped'." \
"     offending:" \
"$(printf '%s\n' "$badmarks" | head -5 | sed 's/^/       /')" ""
fi

# 3) overall bloat ceiling
if [ "$total" -gt "$CEIL" ]; then
  fail "" \
"  ⛔ 0audit.md is $total lines (> $CEIL) — drifting back into a changelog." \
"     Compact it: drop done/stale items (git keeps them). The register holds ONLY" \
"     what is currently true. See /CLAUDE.md 'Audit register'." ""
fi

# 4) breadcrumb list stays short
if [ "$breadcrumb_lines" -gt "$BREADCRUMB_MAX" ]; then
  fail "" \
"  ⛔ '## Recently shipped' has $breadcrumb_lines bullets (> $BREADCRUMB_MAX) — trim the" \
"     oldest. git log is the full history; this section is only recent breadcrumbs." ""
fi

exit 0
