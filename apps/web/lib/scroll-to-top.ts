/**
 * Put the view back at the top when the content underneath is REPLACED — a cockpit takeover
 * (update / sign-in / pairing / T3 / renew) or a wizard step change.
 *
 * Why a helper and not `window.scrollTo(0, 0)`: the dashboard does not scroll the window. Its shell
 * renders `<main className="… overflow-y-auto …">` (dashboard-shell.tsx), so `main` is the scrolling
 * element and the window's own scrollY is always 0 there — calling `window.scrollTo` alone is a
 * silent no-op on exactly the pages that need this. We scroll the nearest scrollable ancestor AND
 * the window, so it works inside the dashboard shell and on any page that scrolls normally.
 *
 * The bug this fixes: a full-page takeover or a next wizard step inherits the previous view's scroll
 * offset, so tapping a control at the bottom of a long mobile page opened the new view already
 * scrolled past its heading (owner report, 2026-08-27).
 *
 * `auto`, never `smooth`: the content is being swapped, so animating the OUTGOING view reads as a
 * glitch rather than as motion.
 */
export function scrollViewToTop(from?: HTMLElement | null): void {
  if (typeof window === "undefined") return;

  // The dashboard's scroller. Prefer an explicit anchor's own scrollable ancestor when given, then
  // fall back to the shell's <main> — covers a takeover that renders no shared ref.
  const scrollers: (Element | null)[] = [];
  for (let el: HTMLElement | null = from ?? null; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      scrollers.push(el);
      break;
    }
  }
  scrollers.push(document.querySelector("main"));

  for (const el of scrollers) {
    if (el && el.scrollTop > 0) el.scrollTo({ top: 0, behavior: "auto" });
  }
  // Plain pages (outside the dashboard shell) scroll the window itself.
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "auto" });
}
