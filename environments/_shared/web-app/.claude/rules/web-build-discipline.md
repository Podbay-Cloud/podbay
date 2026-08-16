# Web build discipline — keep it working, debug cheap

## Never trade a working app for a broken "improvement"
Make changes incrementally and **verify in the live preview after each step** before moving on. If a
refactor (e.g. "make it snappier") breaks interactivity, that's a regression — a slow-but-working
page beats a fast-but-dead one. Keep the app usable at every commit.

## Dead buttons / unresponsive UI in Next.js App Router — check these FIRST (seconds, not minutes)
1. **`"use client"`** is at the top of every component that uses `onClick`, `onChange`, `useState`,
   or `useEffect`. Missing it makes handlers silently do nothing — the #1 cause of dead buttons.
2. **The Next dev-server output** (the `pnpm dev` logs) for build/runtime errors and **hydration
   mismatch** warnings — a hydration error can kill all interactivity on the page.
3. **The component actually receives its data/handlers** as props (server → client boundary).

## Debug cheap; verify with the browser
Two different moments, two different tools:
- **Debugging** a broken button: do the cheap checks above first. Do NOT `sudo apt`/install system
  libs or a browser from scratch to chase it — that's slow and pollutes the pod.
- **Verifying** a flow works end-to-end before you call it done: use the **`webapp-testing` skill**.
  Chromium + Playwright are **prebaked at `/opt/ms-playwright`** (`$PLAYWRIGHT_BROWSERS_PATH` points
  there) on envs that declare `capabilities.browserTesting` — the default — so click-test the real
  pages (add a lead, open it, submit a form) rather than assuming it works.
  **The browser is ALREADY installed — never run `playwright install`.** That command DOWNLOADS a
  browser, and a pod is a datacenter with restricted egress, so it fails — **that failure is EXPECTED
  and is NOT a "network wall". It does not mean you can't verify; you just fetched a second copy you
  don't need.** Don't conclude egress is blocked and don't ask for more resources — neither is the
  problem. Also don't judge by `~/.cache/ms-playwright` (Playwright's default path, empty on a pod);
  the browser is at `/opt/ms-playwright`. Sanity check: `echo $PLAYWRIGHT_BROWSERS_PATH` →
  `/opt/ms-playwright`, `ls /opt/ms-playwright` → a `chromium-*` dir, then just launch.
  The ONE real failure: Chromium dies on `libnspr4.so: cannot open shared object file` → the pod
  predates the system-libs fix (Incus images before 2026-07-27 shipped the binaries but not the
  libs). That's an image gap — say so and update the pod; do not `sudo apt` your way out of it.

## Two gotchas that cost real agent-turns (dogfood, 2026-07-29)

**lucide has NO brand icons.** `Github`, `Linkedin`, `Twitter`/`X` do not exist in the version this
image ships (verified: 1.24). Don't hunt for them, don't add a second icon package. Use a generic
that carries the shape — `Code` for a repo, `Briefcase` for a professional profile, `AtSign` for a
handle, `Hash` for a forum, `Globe` for a site — and let the **label** carry the meaning.

**A wide table HIDES columns instead of breaking.** The shadcn `Table` puts every cell on
`whitespace-nowrap` inside an `overflow-x-auto` container. So one long value (a source URL, a note)
silently pushes the rightmost column — usually Status or the actions — out of *view*: it is scrolled
away, not missing, so nothing looks broken and the user reports "the Status column disappeared".

- Cap long text cells: `<div className="max-w-[200px] truncate" title={value}>` — truncate visibly,
  full value on hover.
- Never put the column the user scans for (status, actions) last if any other column can grow.
- Check the real thing, not the markup: assert `container.scrollWidth === container.clientWidth`
  at desktop width in a browser test.
