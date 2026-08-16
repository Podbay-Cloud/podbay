import Link from "next/link";

/**
 * Shared shell for the long-form legal pages (/privacy, /terms, /cookies): back-to-home,
 * title, last-updated, intro, the prose container, and a contact footer. The pages supply
 * their own section content.
 */
export default function LegalDoc({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-[13px] font-medium text-[var(--accent-light)] hover:underline">
        ← Podbay
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">Last updated: {updated}</p>
      {intro && <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{intro}</p>}

      <article className="legal-prose mt-8">{children}</article>

      <footer className="mt-12 border-t border-border/60 pt-4 text-[12.5px] text-muted-foreground">
        Questions? Email{" "}
        <a href="mailto:privacy@podbay.cloud" className="text-[var(--accent-light)] hover:underline">
          privacy@podbay.cloud
        </a>
        . See also our{" "}
        <Link href="/privacy" className="text-[var(--accent-light)] hover:underline">Privacy Policy</Link>,{" "}
        <Link href="/terms" className="text-[var(--accent-light)] hover:underline">Terms</Link>, and{" "}
        <Link href="/cookies" className="text-[var(--accent-light)] hover:underline">Cookie Policy</Link>.
      </footer>
    </main>
  );
}
