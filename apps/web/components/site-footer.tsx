import Link from "next/link";

/**
 * Landing footer — the standard trust/legal row every public page should carry. Kept
 * quiet so it doesn't compete with the page above it.
 */
export default function SiteFooter() {
  const year = 2026;
  return (
    <footer className="border-t border-border/60 px-4 py-8 text-[13px] text-muted-foreground">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <span>© {year} Podbay</span>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link href="/docs" className="hover:text-foreground">Docs</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/cookies" className="hover:text-foreground">Cookies</Link>
          <a href="mailto:support@podbay.cloud" className="hover:text-foreground">Support</a>
        </nav>
      </div>
    </footer>
  );
}
