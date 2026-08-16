# Surface deferred work — never silently punt

As you work, you WILL hit things you decide not to do right now: a bug you worked
around instead of fixing, a hacky shortcut, a test you skipped, a "TODO later", an
edge case you punted, a dependency or config smell you noticed in passing.

**Tell the user about these — don't let them vanish.** The failure mode this
prevents: work that looks finished but quietly carries known issues the user never
heard about, and rediscovers painfully later.

- When you defer, work around, or hack something to keep moving, **say so in the
  moment** — one line: what you skipped/hacked, and why.
- Before you call a task done, do a conscious pass: "what did I defer, work
  around, or leave fragile?" If the answer is "nothing", that's a real check, not
  a skip.
- Keep it honest and specific (file + what) — not a vague disclaimer.

This is about **surfacing**, not paperwork. Don't create or maintain a tracking
file on your own initiative — if a running register would help, OFFER it and let
the user decide whether and where to keep it.
