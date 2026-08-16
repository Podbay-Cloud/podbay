---
name: doc-ingestion
description: >-
  Get the user's documents INTO the bot cleanly — accept common formats
  (txt/md/pdf/docx/html), extract readable text, chunk it well for retrieval, and
  report back what was actually indexed. Use when the user wants to add their docs,
  when an upload fails or indexes badly, or when answers are missing content you'd
  expect (usually an ingestion problem, not a retrieval one).
---

# Document ingestion

Retrieval can only find what got indexed. Bad ingestion (garbled PDF text, a whole
doc as one chunk, silent format failures) looks like a "dumb bot" but is really a
pipeline problem. Get the text in clean, chunked, and confirmed.

## Formats

- **txt / md** — use as-is (markdown structure helps chunk boundaries).
- **pdf** — extract text server-side (e.g. `pdf-parse`); watch for scanned/image PDFs
  (no text layer → needs OCR, out of v1 scope — tell the user).
- **docx** — extract with `mammoth` or similar → text/markdown.
- **html / web page** — strip to readable text (drop nav/scripts).
- Reject or warn on formats you can't extract; never silently index empty text.

## Chunking (this is where quality is won or lost)

- Split into **~1000–1500 char chunks on natural boundaries** (paragraphs/headings),
  with a small **overlap (~10–15%)** so an answer straddling a boundary is still
  retrievable. (`rag.ts` `chunk` does this — reuse it.)
- Keep chunks self-contained: prepend the doc title / nearest heading so a lone chunk
  still has context.
- Very long docs: chunk fully; don't truncate. Very short docs: still one+ chunk.

## Report back (always)

After ingesting, tell the user **what actually got indexed**: doc name, chunk count,
and flag anything skipped (unreadable pages, unsupported format). "Indexed 3 docs,
142 chunks; skipped 2 image-only PDF pages" — so they trust the corpus.

## Demo docs

A small demo set ships so the bot works on first boot. When the user brings their own,
**offer to clear the demo** (via the docs list / DELETE) so answers come only from
their content — a bot citing demo docs in production is confusing.

## Never

- Never index empty or garbled text and call it done — verify extraction first.
- Never dump a whole document as a single chunk (kills retrieval precision).
- Never leave the demo docs mixed with the user's real docs in production.
