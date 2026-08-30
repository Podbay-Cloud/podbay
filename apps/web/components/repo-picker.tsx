"use client";

import { useMemo, useState } from "react";
import { Check, Lock, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo } from "@/lib/github-connect";

/**
 * Inline repository picker: a search box over a BOUNDED, scrollable list of one-line rows
 * (🔒 private · owner/repo · updated-ago). Bigger tap targets than a native <select> or a
 * dropdown, and — since a whole step/panel is dedicated to choosing one repo — it's shown
 * inline (no popover to open). Self-contained, no combobox dep. The list is capped so it
 * never runs past the viewport; the user scrolls it or narrows with the search.
 */
function ago(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 0) return "";
  if (s < 3600) return "just now";
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

export function RepoPicker({
  repos,
  value,
  onChange,
  placeholder = "Search repositories…",
  triggerId,
  labelledBy,
}: {
  repos: Repo[];
  value: string;
  onChange: (repo: string) => void;
  placeholder?: string;
  /** id for the search input, so the field's `<Label htmlFor>` targets it. */
  triggerId?: string;
  /** id of the field label, for `aria-labelledby` on the search + list. */
  labelledBy?: string;
}) {
  const [query, setQuery] = useState("");
  const valueId = triggerId ? `${triggerId}-value` : undefined;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
    // The chosen repo floats to the top; otherwise most-recently-updated first (what you usually want).
    return [...list].sort((a, b) => {
      const sel = Number(b.fullName === value) - Number(a.fullName === value);
      return sel !== 0 ? sel : Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  }, [repos, query, value]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-transparent px-3">
        <Search className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        <input
          id={triggerId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          aria-labelledby={labelledBy}
          aria-describedby={valueId}
        />
      </div>
      <div
        role="listbox"
        aria-labelledby={labelledBy}
        className="max-h-72 divide-y divide-border/50 overflow-y-auto overscroll-contain rounded-md border border-border/60"
      >
        {matches.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">
            {repos.length === 0 ? "No repositories found on this account." : "No repositories match."}
          </p>
        ) : (
          matches.map((r) => {
            const on = r.fullName === value;
            return (
              <button
                key={r.fullName}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onChange(r.fullName)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors",
                  on
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                {r.private ? (
                  <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-label="private" />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{r.fullName}</span>
                <span className="shrink-0 tabular-nums text-[11.5px] text-muted-foreground">{ago(r.updatedAt)}</span>
                {on && <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />}
              </button>
            );
          })
        )}
      </div>
      {value && (
        <span id={valueId} className="sr-only">
          Selected repository: {value}
        </span>
      )}
    </div>
  );
}
