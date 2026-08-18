#!/usr/bin/env bash
# Podbay pod-base — shared config-refresh operations (authored by Podbay).
#
# These are the idempotent, hash-guarded "refresh" steps that reconcile a pod's on-disk agent config
# (rules → CLAUDE.md, the managed settings.json slice + the relentless Stop hook, codex AGENTS.md,
# skills) with the CURRENT pod-base + env layer. They were inline in init.sh; they now live here as
# functions so BOTH callers share ONE source of truth:
#   · init.sh   — runs them on every boot (the historical trigger).
#   · podbay-refresh — runs them on demand against a RUNNING pod, WITHOUT restarting the agent
#     (docs/plans/live-config-refresh.md). settings/hooks/permissions + skills reach the live agent
#     via Claude Code's file watcher / next skill use; CLAUDE.md prose lands at the next compaction.
#
# Every function is idempotent and NEVER clobbers a user's own edits (hash markers). Every path is
# `${VAR:-default}` so base-image.test.ts can extract each sentinel-delimited BODY and run it against
# temp dirs. Keep the sentinels and the ${VAR:-default} indirection.

# Rules → ~/.claude/CLAUDE.md (USER memory). Reloads in a live session only at the next /compact.
pb_refresh_runtime_rules() {
# >>> podbay:runtime-rules-refresh — base-image.test.ts extracts this block verbatim and
# runs it against temp paths, so the three behaviours below are covered by a real test
# rather than a source grep. Keep the sentinels and the ${VAR:-default} indirection.
RULES_SRC="${RULES_SRC:-/opt/podbay/runtime-rules.md}"
CLAUDE_MD="${CLAUDE_MD:-/home/dev/.claude/CLAUDE.md}"
RULES_MARKER="${RULES_MARKER:-$(dirname "$CLAUDE_MD")/.podbay-runtime-hash}"
RULES_OWNER="${RULES_OWNER:-dev:dev}"
if [ -f "$RULES_SRC" ]; then
  RULES_DIR="$(dirname "$CLAUDE_MD")"
  mkdir -p "$RULES_DIR"
  NEW_HASH="$(sha256sum "$RULES_SRC" | awk '{print $1}')"
  if [ ! -f "$CLAUDE_MD" ]; then
    cp "$RULES_SRC" "$CLAUDE_MD"
    printf '%s' "$NEW_HASH" > "$RULES_MARKER"
  else
    CUR_HASH="$(sha256sum "$CLAUDE_MD" | awk '{print $1}')"
    PREV_HASH="$(cat "$RULES_MARKER" 2>/dev/null || true)"
    if [ "$CUR_HASH" = "$NEW_HASH" ]; then
      printf '%s' "$NEW_HASH" > "$RULES_MARKER"          # already current — (re)assert marker
    elif [ -n "$PREV_HASH" ] && [ "$CUR_HASH" = "$PREV_HASH" ]; then
      cp "$RULES_SRC" "$CLAUDE_MD"                        # untouched since we wrote it → refresh
      printf '%s' "$NEW_HASH" > "$RULES_MARKER"
    else
      cp "$RULES_SRC" "$RULES_DIR/podbay-runtime.md"      # user-edited → never clobber
    fi
  fi
  chown "$RULES_OWNER" "$CLAUDE_MD" "$RULES_MARKER" "$RULES_DIR/podbay-runtime.md" 2>/dev/null || true
fi
# <<< podbay:runtime-rules-refresh
}

# Permission preset + the relentless Stop hook → ~/.claude/settings.json (podbay-managed slice only).
# Claude Code's file watcher applies hooks/permissions to a LIVE session with no restart.
pb_refresh_settings() {
# >>> podbay:settings-refresh — base-image.test.ts extracts this block verbatim and runs
# it against temp paths, so the behaviours (create / migrate-stale / preserve-user-edit /
# propagate) are covered by a real test. Keep the sentinels and the ${VAR:-default} form.
SETTINGS_SPEC="${SETTINGS_SPEC:-${SPEC:-/etc/podbay/pod-spec.json}}"
SETTINGS_JSON="${SETTINGS_JSON:-/home/dev/.claude/settings.json}"
SETTINGS_MARKER="${SETTINGS_MARKER:-$(dirname "$SETTINGS_JSON")/.podbay-settings-hash}"
SETTINGS_OWNER="${SETTINGS_OWNER:-dev:dev}"
if [ -f "$SETTINGS_SPEC" ]; then
  python3 - "$SETTINGS_SPEC" "$SETTINGS_JSON" "$SETTINGS_MARKER" <<'PY' || true
import json, hashlib, os, sys

# Refresh the podbay-MANAGED permission fields in ~/.claude/settings.json from the pod's
# preset, every boot — so a preset change (a new deny, a removed prompt) reaches EXISTING
# pods instead of being frozen by a seed-once write. Never clobbers a user's own edits,
# and always preserves keys podbay doesn't manage (e.g. app toggles).
SPEC, SETTINGS, MARKER = sys.argv[1], sys.argv[2], sys.argv[3]

try:
    rules = json.load(open(SPEC)).get("permissions", {}).get("rules", {})
except Exception:
    sys.exit(0)

# The MANAGED slice: mode + the three permission lists. Everything else in settings.json
# is left untouched.
MANAGED_ALLOW = list(rules.get("allow", []))
desired = {
    "defaultMode": rules.get("defaultMode", "acceptEdits"),
    "allow": MANAGED_ALLOW,
    "deny": list(rules.get("deny", [])),
    "ask": list(rules.get("ask", [])),
}

def managed_of(d):
    p = d.get("permissions", {})
    return {
        "defaultMode": d.get("defaultMode", "acceptEdits"),
        "allow": list(p.get("allow", [])),
        "deny": list(p.get("deny", [])),
        "ask": list(p.get("ask", [])),
    }

def h(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()

def apply(cur):
    # Merge the managed slice INTO cur, preserving every other key.
    cur["defaultMode"] = desired["defaultMode"]
    p = cur.setdefault("permissions", {})
    p["allow"], p["deny"], p["ask"] = desired["allow"], desired["deny"], desired["ask"]
    return cur

new_hash = h(desired)
os.makedirs(os.path.dirname(SETTINGS) or ".", exist_ok=True)

if not os.path.exists(SETTINGS):
    json.dump(apply({}), open(SETTINGS, "w"), indent=2)
    open(MARKER, "w").write(new_hash)
    sys.exit(0)

cur = json.load(open(SETTINGS))
cur_managed = managed_of(cur)
cur_hash = h(cur_managed)
prev_hash = ""
try:
    prev_hash = open(MARKER).read().strip()
except Exception:
    pass

# Is the CURRENT settings a podbay-managed shape rather than a user's own? The allow list
# is podbay's signature (Read/Edit/Bash(*)); if it matches, the managed fields are ours to
# refresh even without a marker (migrates pods seeded before this refresh existed).
looks_podbay = cur_managed["allow"] == MANAGED_ALLOW

if cur_hash == new_hash:
    open(MARKER, "w").write(new_hash)                       # already current → assert marker
elif (prev_hash and cur_hash == prev_hash) or (not prev_hash and looks_podbay):
    json.dump(apply(cur), open(SETTINGS, "w"), indent=2)    # untouched by user → refresh, keep other keys
    open(MARKER, "w").write(new_hash)
else:
    # User-customized the managed fields → never clobber. Record a baseline so future
    # podbay changes can be offered without a re-migration guess.
    open(MARKER, "w").write(cur_hash)
PY
  chown "$SETTINGS_OWNER" "$SETTINGS_JSON" "$SETTINGS_MARKER" 2>/dev/null || true
fi

# ---- Stop hook: the enforcement half of the `relentless` rule ----------------------------
# >>> podbay:stop-hook - base-image.test.ts extracts and runs this python
STOP_HOOK="${STOP_HOOK:-/opt/podbay/hooks/relentless-stop.py}"
if [ -f "$STOP_HOOK" ]; then
  python3 - "$SETTINGS_JSON" "$STOP_HOOK" <<'PY' || true
import json, os, sys
SETTINGS, HOOK = sys.argv[1], sys.argv[2]
try:
    cur = json.load(open(SETTINGS)) if os.path.exists(SETTINGS) else {}
except Exception:
    sys.exit(0)                      # unreadable settings: never make it worse
entry = {"hooks": [{"type": "command", "command": HOOK}]}
hooks = cur.setdefault("hooks", {})
stop = hooks.get("Stop") or []
if any(HOOK in json.dumps(g) for g in stop):
    sys.exit(0)                      # already registered -> nothing to do
hooks["Stop"] = stop + [entry]       # append: do not drop the user's own Stop hooks
os.makedirs(os.path.dirname(SETTINGS) or ".", exist_ok=True)
json.dump(cur, open(SETTINGS, "w"), indent=2)
print("init: registered the relentless Stop hook")
PY
  chown "$SETTINGS_OWNER" "$SETTINGS_JSON" 2>/dev/null || true
fi
# <<< podbay:stop-hook
# <<< podbay:settings-refresh
}

# Codex rule literacy → ~/.codex/AGENTS.md (codex-pods only; block-replace, non-destructive).
pb_refresh_codex_agents() {
# >>> podbay:codex-agents-rules — base-image.test.ts extracts this python and runs it
# against PODBAY_CODEX_* overrides, so the assembly/replacement is covered by a test.
python3 - <<'PY' || true
import os, glob, json, tempfile
agent = os.environ.get("PODBAY_AGENT")
if agent is None:
    try:
        spec = os.environ.get("PODBAY_SPEC", "/etc/podbay/pod-spec.json")
        a = json.load(open(spec)).get("agents") or []
        # ANY declared agent, not agents[0]. A claude-PRIMARY pod that also declares
        # codex still needs ~/.codex/AGENTS.md — without it codex runs with none of
        # the podbay runtime rules, INCLUDING confirm-before-outbound. That is every
        # `agents: [claude-code, codex]` pod we ship (found 2026-07-29).
        agent = "codex" if "codex" in a else (a[0] if a else "")
    except Exception:
        agent = ""
if agent != "codex":
    raise SystemExit(0)                              # claude-only pods: nothing to do
dst = os.environ.get("PODBAY_CODEX_AGENTS", "/home/dev/.codex/AGENTS.md")
runtime = os.environ.get("PODBAY_RUNTIME_RULES", "/opt/podbay/runtime-rules.md")
rulesdir = os.environ.get("PODBAY_ENV_RULES_DIR", "/etc/podbay/claude/rules")
BEGIN = "<!-- BEGIN:podbay-runtime (authored by Podbay - do not edit; regenerated each boot) -->"
END = "<!-- END:podbay-runtime -->"
parts = []
if os.path.exists(runtime):
    parts.append(open(runtime, encoding="utf-8", errors="replace").read().rstrip())
for rf in sorted(glob.glob(os.path.join(rulesdir, "*.md"))):
    body = open(rf, encoding="utf-8", errors="replace").read().rstrip()
    parts.append("<!-- source: .claude/rules/%s -->\n%s" % (os.path.basename(rf), body))
if not parts:
    raise SystemExit(0)                              # no rules to publish yet (pre-spec)
block = BEGIN + "\n\n" + "\n\n".join(parts) + "\n\n" + END
existing = ""
if os.path.exists(dst):
    try:
        existing = open(dst, encoding="utf-8", errors="replace").read()
    except Exception:
        raise SystemExit(0)                          # unreadable: leave it alone
if BEGIN in existing and END in existing:
    new = existing.split(BEGIN)[0] + block + existing.split(END, 1)[1]
else:
    new = (existing.rstrip() + "\n\n" if existing.strip() else "") + block + "\n"
if new == existing:
    raise SystemExit(0)                              # already current
os.makedirs(os.path.dirname(dst), exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dst))
with os.fdopen(fd, "w") as f:
    f.write(new)
os.replace(tmp, dst)
print("init: assembled codex AGENTS.md (%d rule sources)" % len(parts))
PY
chown dev:dev /home/dev/.codex/AGENTS.md 2>/dev/null || true
# <<< podbay:codex-agents-rules
}

# Codex skills: translate the env's Claude skills into ~/.codex/skills (codex-pods only).
pb_translate_codex_skills() {
# >>> podbay:codex-skills-translate — base-image.test.ts extracts and runs this block
# against temp dirs via the CODEX_SKILLS_* overrides, so the copy is covered by a test.
CODEX_SKILLS_SPEC="${PODBAY_SPEC:-/etc/podbay/pod-spec.json}"
CODEX_SKILLS_AGENT="${CODEX_SKILLS_AGENT:-$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1])).get("agents") or []; print("codex" if "codex" in a else (a[0] if a else ""))' "$CODEX_SKILLS_SPEC" 2>/dev/null)}"
CODEX_SKILLS_SRC="${CODEX_SKILLS_SRC:-/etc/podbay/claude/skills}"
CODEX_SKILLS_DEST="${CODEX_SKILLS_DEST:-/home/dev/.codex/skills}"
CODEX_SKILLS_OWNER="${CODEX_SKILLS_OWNER:-dev:dev}"
if [ "$CODEX_SKILLS_AGENT" = "codex" ] && [ -d "$CODEX_SKILLS_SRC" ]; then
  mkdir -p "$CODEX_SKILLS_DEST"
  n=0
  for d in "$CODEX_SKILLS_SRC"/*/; do
    [ -d "$d" ] || continue                       # no skills → glob stays literal
    name=$(basename "$d")
    [ "$name" = ".system" ] && continue           # never shadow codex's built-ins
    rm -rf "$CODEX_SKILLS_DEST/$name"
    cp -r "$d" "$CODEX_SKILLS_DEST/$name" && n=$((n+1))
  done
  chown -R "$CODEX_SKILLS_OWNER" "$CODEX_SKILLS_DEST" 2>/dev/null || true
  echo "podbay: translated $n env skills -> $CODEX_SKILLS_DEST (codex)"
fi
# <<< podbay:codex-skills-translate
}

# Env rules → ~/work/CLAUDE.md (PROJECT-root; the /compact-refreshable layer). Non-BYO only.
pb_refresh_work_rules() {
WORK="${WORK:-/home/dev/work}"
GH_REPO="${GH_REPO:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("githubRepo") or "")' "${SPEC:-/etc/podbay/pod-spec.json}" 2>/dev/null || true)}"
# >>> podbay:work-rules-refresh — base-image.test.ts extracts this block verbatim and
# exercises fresh-seed / refresh-on-change / never-clobber-user-edits with overridden paths.
if [ -z "$GH_REPO" ] && ls "$WORK/.claude/rules/"*.md >/dev/null 2>&1; then
  WORK_RULES_MARKER="$WORK/.claude/.podbay-rules-hash"
  ASSEMBLED="$(mktemp)"
  {
    echo "# Project rules (assembled by podbay from .claude/rules — always in effect)"
    echo
    for r in "$WORK/.claude/rules/"*.md; do
      echo "<!-- source: .claude/rules/$(basename "$r") -->"
      cat "$r"
      echo
    done
  } > "$ASSEMBLED"
  NEW_WORK_HASH="$(sha256sum "$ASSEMBLED" | cut -d' ' -f1)"
  if [ ! -f "$WORK/CLAUDE.md" ]; then
    cp "$ASSEMBLED" "$WORK/CLAUDE.md"
    printf '%s' "$NEW_WORK_HASH" > "$WORK_RULES_MARKER"
  else
    CUR_WORK_HASH="$(sha256sum "$WORK/CLAUDE.md" 2>/dev/null | cut -d' ' -f1)"
    PREV_WORK_HASH="$(cat "$WORK_RULES_MARKER" 2>/dev/null || true)"
    if [ "$CUR_WORK_HASH" = "$PREV_WORK_HASH" ] && [ "$CUR_WORK_HASH" != "$NEW_WORK_HASH" ]; then
      cp "$ASSEMBLED" "$WORK/CLAUDE.md"                 # untouched since we wrote it → refresh
      printf '%s' "$NEW_WORK_HASH" > "$WORK_RULES_MARKER"
    elif [ -z "$PREV_WORK_HASH" ]; then
      : # pre-marker pod with an existing CLAUDE.md: can't tell ours from theirs — never clobber
    fi
  fi
  rm -f "$ASSEMBLED"
  chown dev:dev "$WORK/CLAUDE.md" "$WORK_RULES_MARKER" 2>/dev/null || true
fi
# <<< podbay:work-rules-refresh
}

# Claude skills: SURGICALLY refresh ~/.claude/skills (or ~/work/.claude/skills for BYO) from the
# freshly-delivered layer — WITHOUT the seed-once full-.claude copy (which would clobber user edits
# to other ~/.claude files). Skills are read on-demand by the Skill tool, so a running session picks
# up an added/edited skill live. This is the every-refresh analog of the seed-time .claude copy.
pb_refresh_claude_skills() {
  local src="${CLAUDE_SKILLS_SRC:-/etc/podbay/claude/skills}"
  [ -d "$src" ] || return 0
  local gh dest
  gh="${GH_REPO:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("githubRepo") or "")' "${SPEC:-/etc/podbay/pod-spec.json}" 2>/dev/null || true)}"
  if [ -n "$gh" ]; then dest="/home/dev/.claude/skills"; else dest="${WORK:-/home/dev/work}/.claude/skills"; fi
  dest="${CLAUDE_SKILLS_DEST:-$dest}"
  mkdir -p "$dest"
  # Mirror the delivered skills into place. Per-skill replace so a renamed/removed file inside a
  # skill is reflected, without touching non-skill files in the parent .claude dir.
  local n=0 d name
  for d in "$src"/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    rm -rf "${dest:?}/$name"
    cp -r "$d" "$dest/$name" && n=$((n + 1))
  done
  chown -R dev:dev "$dest" 2>/dev/null || true
  echo "podbay: refreshed $n claude skills -> $dest"
}
