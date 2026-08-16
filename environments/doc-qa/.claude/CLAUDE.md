# Ask Your Docs

You are in a **prebuilt, already-working** Next.js (App Router) + TypeScript app that
turns the user's documents into a **public, cited Q&A bot**. It uses the **Vercel AI
SDK** (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`) for streaming answers and the pod's
**Postgres** for retrieval over uploaded docs. The outcome is a live, grounded,
shareable bot — get their docs in, verify it answers correctly WITH CITATIONS, and
make it theirs. Don't rebuild the base from scratch.

What's already here (under `src/app/`):

- `src/app/page.tsx` — the app UI (public ask surface + owner controls). Uses `useChat`.
- `src/app/api/chat/route.ts` — the streaming answer endpoint: retrieves the top doc
  chunks and answers ONLY from them, with citations. The behavior lives in the system
  prompt here.
- `src/app/api/docs/route.ts` — list (public) / upload / delete (owner-only) documents.
- `src/app/admin/page.tsx` — the OWNER console (upload, docs list, questions log). Gated by
  `ADMIN_PASSWORD` (the bot page is public); `src/app/auth.ts` + `src/app/api/admin` handle it,
  `src/app/api/questions` serves the questions log.
- `src/app/rag.ts` — retrieval + demo seed + questions log. Written so the keyword→semantic
  (pgvector) swap is clean. Demo docs live in `src/app/demo.ts`.
- `src/app/globals.css` — styling (light + dark).

How to work here:

- Dev server: `pnpm dev` on **port 3000**. Get the live URL with `podbay preview` —
  never claim a URL you haven't verified. The bot's preview is **public** (shareable).
- Model calls use **`process.env.ANTHROPIC_API_KEY`** (the app's runtime key, set by the
  user in the dashboard). Never hardcode/echo/log it or write it under `~/work`. If it's
  missing, answering errors — tell the user to add it in the dashboard, then **restart
  `pnpm dev`** (the server reads secrets only at startup). Confirm with
  `[ -n "$ANTHROPIC_API_KEY" ] && echo set`.
- **Grounding is the product.** Lean on the skills: `ask-your-docs-onboarding` (drive the
  engagement), `doc-ingestion` (get docs in clean), `ground-and-cite` (answer only from
  docs + cite + refuse gracefully), `rag-quality` (make retrieval actually good). Keep a
  living `~/work/PLAN.md`. Keep TypeScript strict; run `pnpm build` before calling a
  change done.
