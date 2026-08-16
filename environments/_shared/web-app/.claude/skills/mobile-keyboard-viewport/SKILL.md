---
name: mobile-keyboard-viewport
description: Fix the iOS keyboard "composer stranded at the top / page scrolls up" bug in any mobile web app with a bottom-fixed input. Use whenever you build or touch a chat/message/comment/search UI whose input sits at the bottom of a full-height layout.
---

# Mobile keyboard viewport fix (iOS)

## When to use
Any mobile-first web UI with a **bottom-pinned input** in a **full-height** layout
(chat, messaging, comments, a bottom search bar). Symptom to prevent: on iOS
Safari and in-app webviews, tapping the input opens the keyboard and the page
"scrolls up" — the input ends up stranded near the top with dead space below it,
and content is pushed off-screen. `100dvh`/`100vh` does NOT fix this.

## Why it happens
Mobile browsers keep two viewports: the **layout** viewport (CSS lays out against
it) and the **visual** viewport (what's actually visible). When the keyboard opens
iOS (a) shrinks the visual viewport while `100dvh` keeps tracking the layout
viewport, and (b) **pans** the document to reveal the focused input, sliding a
top-pinned app off-screen. CSS units can't opt out — you must size and position
from `window.visualViewport` and lock the document.

## The fix (Next.js App Router; adapt to any framework)

**1. `app/layout.tsx`** — the Android half (keyboard resizes, not overlays):
```ts
import type { Viewport } from "next";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};
```

**2. `globals.css`** — lock the document; size + translate the app from CSS vars:
```css
html, body { height: 100%; }
body { position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none; }
.app {                                     /* the full-height flex column */
  height: 100dvh;                          /* pre-JS / desktop fallback */
  height: var(--app-h, 100dvh);            /* real visible height */
  transform: translateY(var(--app-y, 0px)); /* follow the visual-viewport pan */
}
/* ONLY the scrollable region (e.g. the message list) scrolls: */
.messages-scroll { flex: 1; overflow-y: auto; }
```

**3. The client component** — sync the vars from `visualViewport`:
```ts
useEffect(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    const root = document.documentElement;
    root.style.setProperty("--app-h", `${vv.height}px`);
    root.style.setProperty("--app-y", `${vv.offsetTop}px`); // ← the piece most fixes miss
    window.scrollTo(0, 0);                                   // undo residual pan
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); // keep newest visible
  };
  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync); // iOS PANS without firing 'resize' — listen to scroll too
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
  };
}, []);
```

## Non-negotiables / gotchas
- **`translateY(offsetTop)`** is the piece most fixes miss: even with a fixed body,
  iOS still pans the visual viewport. Translating by `offsetTop` keeps the app
  glued to what's visible.
- **Listen to `scroll`, not just `resize`** — iOS pans without resizing in several
  cases (in-app webviews are the worst offenders).
- **Composer input `font-size: 16px` (never smaller).** Below 16px iOS Safari
  auto-zooms the page on focus — a separate bug with an identical-looking symptom
  that compounds this one. (Best set globally: `@media (max-width:640px){
  input,textarea,select{font-size:16px !important} }`.)
- Ship BOTH halves: `interactiveWidget` is Android, the `visualViewport` sync is iOS.

## Verify
On an iPhone (Safari AND an in-app webview like the Google app — webviews are
worse): tap the input. The composer should stay pinned just above the keyboard
with the scroll region compressed above it — no dead space below, nothing pushed
off-screen. Dismiss the keyboard → full height returns. Rotate with the keyboard
open. On desktop, the layout is unchanged (the vars are unset → `100dvh`, no
translate).
