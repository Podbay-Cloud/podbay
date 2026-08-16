import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The one page scaffold every dashboard route renders into, so all pages share
 * the same container width, padding rhythm, and header pattern (back link →
 * title + actions → content). Cards/blocks span the container's full width —
 * this is what keeps the dashboard visually uniform. Don't add per-page
 * max-widths inside it — use `wide` for data-dense backoffice tables instead.
 */
export default function DashboardPage({
  title,
  intro,
  backHref,
  backLabel,
  actions,
  wide,
  children,
}: {
  /** Page h1. Omit when the page renders its own hero header (e.g. the cockpit). */
  title?: string;
  /** Roomier container for data-dense tables (backoffice pods/users). */
  wide?: boolean;
  /** One-line description under the title. */
  intro?: string;
  backHref?: string;
  backLabel?: string;
  /** Right-aligned header actions (buttons/links). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto w-full ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
      {backHref && (
        <Link
          href={backHref}
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> {backLabel ?? "Back"}
        </Link>
      )}
      {(title || actions) && (
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>}
            {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="flex flex-col gap-5">{children}</div>
    </div>
  );
}
