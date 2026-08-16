---
name: rag-quality
description: >-
  Make the bot's answers actually good — evaluate and improve RETRIEVAL (does the
  right passage come back for a real question?) and tune the answer behavior. Use
  after docs are loaded, whenever answers are wrong/thin/miss content that IS in the
  docs, or when deciding chunk size / top-k / semantic-vs-keyword search. Test with
  real questions, don't eyeball the code.
---

# RAG quality

The bot is only as good as what retrieval hands the model. Most "bad answer" bugs are
retrieval bugs (the right chunk didn't come back), not model bugs. Diagnose in that order.

## Evaluate with real questions (a mini eval, not vibes)

1. With the owner, write **5–10 real questions** the docs SHOULD answer + a couple the
   docs should NOT (to test refusal).
2. For each: is the **retrieved chunk** the right one? (Log/inspect what `search`
   returns before blaming the model.) Then: is the **answer** correct + cited?
3. Track pass/fail. Re-run after each change. This is the KPI — "answers a real question
   with a correct citation, and refuses when it should."

## Levers (in rough order of impact)

- **Retrieval mode.** Keyword/FTS misses paraphrases ("cancel" vs "terminate"). If the
  user asks in different words than the docs, move to **semantic search (pgvector +
  embeddings)** — the planned upgrade; `rag.ts` is written for the swap.
- **Chunk size / overlap.** Answers cut off mid-thought → chunks too small or bad
  boundaries. Retrieval grabbing irrelevant text → chunks too big. Tune in `chunk`.
- **top-k.** Too few → misses supporting passages; too many → dilutes the context +
  costs tokens. Start ~5; adjust by eval.
- **Refusal threshold.** If top hits are weak (low score / off-topic), refuse rather
  than answer from thin context (ties to `ground-and-cite`).
- **System prompt.** Tighten "only from context, cite, say I-don't-know."

## Unanswered questions = product signal

Surface questions the bot COULDN'T answer to the owner — they're the roadmap for what
docs to add. If the app logs questions, flag the unanswered ones.

## Never

- Never tune by staring at code — change one lever, re-run the eval, compare.
- Never ship a retrieval change without checking the refusal cases still refuse.
