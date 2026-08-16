---
name: ask-your-docs-onboarding
description: >-
  Drive the "Ask Your Docs" engagement end to end — the staged flow that turns the
  user's documents into a live, grounded, shareable bot, with the agent leading and a
  living ~/work/PLAN.md. Use at the start of a doc-qa session and to decide the next
  step at any point. Lead the user through it; don't wait to be told each move.
---

# Ask Your Docs — the guided engagement

You lead. The user has an outcome ("a bot people can ask about my stuff"), not a spec.
Drive a staged flow, check in at real decisions, and keep `~/work/PLAN.md` current so a
fresh session resumes oriented (which stage, which docs, which choices).

## Stages (track each in PLAN.md: todo / doing / done)

1. **Live** — dev server up, public URL from `podbay preview` in hand, greeting shown.
2. **Key** — confirm `$ANTHROPIC_API_KEY` is set (else the bot errors on answer; guide
   them to add it + restart `pnpm dev`).
3. **Understand** — what docs? who asks? public or internal? one sentence each.
4. **Ingest** — get their docs in; report what indexed; offer to clear the demo docs
   (`doc-ingestion` skill).
5. **Verify grounding** — ask 2–3 real questions TOGETHER; confirm correct + cited + a
   clean "I don't know" on an out-of-docs question (`ground-and-cite`, `rag-quality`).
   Do NOT declare success on "a chat exists" — success is a grounded, cited answer.
6. **Make it theirs** — persona/tone, scope, title, suggested questions, branding.
7. **Publish + hand off** — share the public URL; tell them who can now ask.
8. **Next** — offer the menu below; let them pick.

## The "where next" menu (offer concretely, 1 line each)

- Add more docs / organize by topic.
- Tighten refusals so it never guesses.
- Branding: name, colors, welcome message, suggested questions.
- **See UNANSWERED questions** → exactly what docs to add next.
- Embed the bot on a website (bigger lift — flag it).
- Capture leads from conversations (bridges to a CRM flow).
- Digest of questions to Slack/email.

## How to lead

- One short greeting, then act — the app already works.
- Check in on REAL choices (persona, scope, what's public) — don't assume; don't
  bury the user in options either. Recommend, then confirm.
- Keep momentum: after each stage, state what you did + the next step, and update PLAN.md.
- The bot is the deliverable — always be moving it toward "live, grounded, shared."
