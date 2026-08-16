---
name: ship-feature
description: Implement a described feature end-to-end in this Next.js workspace, then verify it builds. Use when the user asks to add or change a user-facing feature.
---

# Ship a feature

1. Clarify the feature in one sentence if ambiguous; otherwise proceed.
2. Implement it under `app/` — routes and colocated components. Server components by default.
3. Keep TypeScript strict; no new dependencies unless clearly required.
4. Run `pnpm build` and fix any type or build errors before declaring done.
5. Summarize what changed and how to see it (the dev server is on port 3000, preview URL available).
