---
name: handoff
description: Write a durable handoff note before this pod is interrupted (update/suspend) so the next session — possibly a different agent — can pick up without re-deriving anything. Use when asked to hand off, or before you expect to be interrupted.
---

# Handoff

You are about to be interrupted. The pod is being updated or suspended, which restarts it and kills
you where you stand. Your files survive. Your in-flight *understanding* does not.

Write one note. Then stop.

## Where

`~/.podbay/handoff/<window>.md` — where `<window>` is your tmux window **index**:

```bash
mkdir -p ~/.podbay/handoff
W=$(tmux display-message -p '#I' 2>/dev/null || echo 0)
```

Use the index, not the name. tmux auto-renames a window to whatever command is running in it, so
`#W` gives you `bash` or `node` depending on the moment — not a stable identity. The platform
addresses windows by index for exactly this reason.

One file per agent window. **Never write another window's file** — another agent may be working there.

`~` is on the pod's persistent volume, so the note survives the restart. Nothing written outside `~`
does — which is the whole point.

**Write the file directly — do NOT write a temp file and rename.** You are racing a kill: on the
first live run an agent's finished note died as `0.md.tmp.<pid>` because the kill landed between
write and rename. Atomicity buys nothing here (the only reader arrives after you are gone); a
partial note beats a perfectly-atomic missing one.

## What to write

Short. Someone reads this under time pressure, and you are writing it under a timeout — a long note
is a failed note. Aim for what fits on one screen.

```markdown
# Handoff — <ISO timestamp>

## What I was doing
<One or two sentences. The goal, not a narration of your last ten tool calls.>

## Why
<The reason this work matters, if it isn't obvious from the goal. Skip if it is.>

## State (verifiable)
- branch: <name> @ <short sha>
- uncommitted changes: <yes — list the files / no>
- pushed: <yes / no — this is what an interrupt actually puts at risk>
- tests: <last known result, and whether you ran them yourself>
- <anything else the next session would otherwise have to re-derive>

## In flight — UNCONFIRMED
<Anything you started but never saw finish. Say how to check. If nothing, write "nothing".>

## Next
<The single next action. Not a plan — the next thing.>
```

## Rules that matter more than the format

**Prefer verifiable state over recollection.** Run the commands. `git status`, `git log -1`,
`git branch --show-current`. Do not write "everything is committed" from memory — check.

**Say what you do not know.** If you kicked off a build, a deploy, or a long test and never saw the
result, that goes under **In flight — UNCONFIRMED** with how to check it. Writing "the deploy
succeeded" when you never saw it succeed is worse than writing nothing: the next session will build
on a false premise and lose more time than the note saved.

**Never claim completion you cannot confirm.** "I fixed X" requires evidence you observed. Otherwise
it is "I changed X; unverified".

**Do not dump your transcript.** The next session may have `--continue` and can read the transcript
itself. This note exists for what the transcript does *not* carry: what you were about to do, what
you were unsure of, and what a *different* agent would need. Assume the reader is not you.

**Uncommitted work is the headline.** The interrupt's real cost is unsaved work. If the tree is
dirty or unpushed, that belongs near the top, not buried in state.

## When you are done

Stop. Do not start new work, do not "just finish this one thing" — you are out of time by
construction. Say in one line that the note is written and where.
