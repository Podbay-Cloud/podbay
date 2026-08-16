#!/usr/bin/env python3
"""Stop hook: enforce the relentless rule that a turn may not end on a prose question.

Every other part of relentless is a prompt asking the agent to remember. This is the only
piece that does not depend on the agent's momentum — and momentum is the documented failure
mode: an agent finishes something notable, writes a good summary, tacks "Want me to X?" on
the end, and the loop dies because a prose question reads as finished work and answering it
is optional. (Diagnosed independently by two agents on two pods before this existed.)

Policy — BLOCK the stop when ALL of:
  1. the final assistant message ends by asking the user something,
  2. the turn made no AskUserQuestion call (which renders selectable options), and
  3. no background task is in flight (whose completion would re-invoke the agent).
Anything else is allowed: those are the two legal endings.

Fails OPEN by design. A hook that crashes must never wedge a session, so any unexpected
error exits 0 and lets the stop through.
"""
import json
import re
import sys

ALLOW = 0


def main() -> int:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return ALLOW

    # Never fight the loop-breaker: if the runtime has already engaged infinite-loop
    # protection, blocking again deadlocks the session.
    if data.get("stop_hook_active") is True:
        return ALLOW

    last = (data.get("last_assistant_message") or "").rstrip()
    if not last:
        return ALLOW

    if not _ends_by_asking(last):
        return ALLOW

    # The transcript LAGS the current turn for the final message, but tool calls made
    # earlier in the turn are already written — which is what we need here.
    tail = _tail(data.get("transcript_path") or "", 400_000)
    if "AskUserQuestion" in tail:
        return ALLOW
    if '"run_in_background":true' in tail.replace(" ", "") or '"run_in_background": true' in tail:
        return ALLOW

    print(json.dumps({
        "decision": "block",
        "reason": (
            "You ended this turn with a question written in prose, with no AskUserQuestion "
            "call and no background task running. That is a stop, not an ask: it reads as "
            "finished work, answering is optional, and nothing resumes if the user says "
            "nothing. Do ONE of these now — (a) if the fork is real, ask it with the "
            "AskUserQuestion tool so it renders as selectable options, batching every "
            "pending question into that one call; or (b) if you can make progress without "
            "the answer, keep working and ask later. Do not simply restate the question."
        ),
    }))
    return ALLOW


def _ends_by_asking(text: str) -> bool:
    """Is the message's closing move a question aimed at the user?"""
    # Consider the tail only: a '?' in the middle of a report is not the closing move.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return False
    closing = " ".join(lines[-3:])
    if closing.endswith("?"):
        return True
    # Common phrasings that solicit a decision without a trailing '?'.
    return bool(re.search(
        r"\b(let me know|tell me which|say the word|your call|want me to|shall i|should i|"
        r"do you want|would you like|which (one|would you)|confirm and i)\b",
        closing, re.IGNORECASE))


def _tail(path: str, nbytes: int) -> str:
    if not path:
        return ""
    try:
        with open(path, "rb") as fh:
            try:
                fh.seek(-nbytes, 2)
            except OSError:
                fh.seek(0)
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # never wedge a session on a hook bug
        sys.exit(ALLOW)
