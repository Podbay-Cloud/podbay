# Resuming after a restart — read the handoff first

This pod restarts on **Update** and **Suspend**. When it does, the agent that was working here was
killed mid-task. Before it went down it may have left you a note.

**On your first turn after a restart, check `~/.podbay/handoff/` before doing anything else.**

- Read the note for your window (`<window>.md`, or `main.md`). If there are notes for other windows,
  read those too — they tell you what the rest of the pod was doing.
- **Treat the note as authoritative about what was in flight.** Where it disagrees with your own
  transcript, the note wins: it was written with knowledge of the interrupt, the transcript was not.
  Your transcript may also have been summarized; the note was not.
- Pay attention to anything marked **UNCONFIRMED** — the previous agent started it and never saw it
  finish. Verify before building on it. That is the single most likely way to lose time here.
- The note may have been written by a **different agent** (Claude/Codex), or not written at all if
  the previous session was busy, wedged, or the pod crashed. An absent note is normal — carry on
  silently, do not report it as an error.

Once you have read it, say in one line where you're picking up, then continue.

**Do not delete or overwrite a note you did not write.** Notes are the owner's record too — they can
open them directly to see what their pod was doing.
