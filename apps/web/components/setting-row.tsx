import type React from "react";

/**
 * One row in a settings/control Card: label + description on the LEFT, the action on the RIGHT,
 * divided from the row above by a top border (`first:border-t-0` so the first row has none). This is
 * the canonical row — reuse it instead of re-implementing the flex+border (see
 * `.claude/rules/ui-patterns.md`). Put rows inside `<Card className="gap-1 py-4"><CardContent className="py-0">`.
 */
export function SettingRow({
  label,
  desc,
  children,
}: {
  /** ReactNode so a row can carry an inline ⓘ / dot beside its name, not just text. */
  label: React.ReactNode;
  desc?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[54px] items-center justify-between gap-4 border-t border-border/60 py-3.5 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-[12.5px] text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </div>
  );
}
