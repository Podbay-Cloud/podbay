import { cn } from "@/lib/utils";

/**
 * A loading placeholder shaped like the content it stands in for — the canonical "still loading"
 * treatment (web-data-layer-react-query). Use it instead of a blank panel or a lone centred spinner
 * (see `.claude/rules/ui-patterns.md`). Compose several to mirror a card/row layout.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

/** A control/settings-row skeleton: a title + description block on the left, an action stub on the
 * right — matches the SettingRow / agent-row shape while a tab's data loads. */
function RowSkeleton() {
  return (
    <div className="flex min-h-[54px] items-center justify-between gap-4 border-t border-border/60 py-3.5 first:border-t-0">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-64 max-w-[60vw]" />
      </div>
      <Skeleton className="h-8 w-28 shrink-0 rounded-md" />
    </div>
  );
}

export { Skeleton, RowSkeleton };
