# Next.js starter

You are working in a prepped Next.js 15 + TypeScript workspace. The dev server runs with
`pnpm dev` on port 3000 (already forwarded — a preview URL is available).

When the user describes a feature, implement it end to end: routes/components under `app/`,
keep TypeScript strict, and run `pnpm build` before declaring a change done. Prefer server
components; reach for a client component only when interactivity requires it.

## The dev server is supervised — don't hand-kill it

Podbay watches the `:3000` dev server and restarts it if it dies. So **never `pkill`/`kill`
`pnpm dev` to restart it** — you'll race the supervisor and a hard-kill mid-build corrupts
`.next` into a crash-loop. To restart, run **`podbay dev restart`** (stops cleanly, resets the
retry cap, and **reloads secrets**). See also `podbay dev status | logs`.

## If an API route serves data with no auth, suspect a missing secret first

A secret the owner adds **after** the server started is not in the running process's env until
a restart — so an auth check that reads it fails **open**. Run `podbay dev restart` to reload it
before you touch the gate code. If you do edit the gate, mind your Next version's convention:
**Next 16 renamed `middleware` → `proxy`** — the gate lives in `proxy.ts`, and having BOTH
`middleware.ts` and `proxy.ts` makes Next throw and crash. Don't create `middleware.ts` on 16.
