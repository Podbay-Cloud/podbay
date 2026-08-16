"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Lock, Search } from "lucide-react";
import type { Repo } from "@/lib/github-connect";

/**
 * Searchable repository picker for the launch form. A native <select> is unusable
 * once you have more than a handful of repos (no filtering, OS-styled, no metadata),
 * and BYO launches start by finding ONE repo among possibly hundreds — so: type to
 * filter, arrow keys to move, Enter to pick. Self-contained (no combobox dep).
 */
export function RepoPicker({
  repos,
  value,
  onChange,
  placeholder = "Search your repositories…",
}: {
  repos: Repo[];
  value: string;
  onChange: (repo: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, query]);

  // Close on outside click / Escape — a picker that traps the page is worse than
  // the native select it replaces.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => setActive(0), [query]);

  function choose(repo: string) {
    onChange(repo);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(matches.length - 1, next));
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = matches[active];
      if (hit) choose(hit.fullName);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm hover:bg-white/[0.03]"
      >
        <span className={value ? "truncate font-medium" : "truncate text-muted-foreground"}>
          {value || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border/60 bg-[var(--navy)] shadow-lg">
          <div className="flex items-center gap-2 border-b border-border/60 px-3">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Filter repositories…"
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1" role="listbox">
            {matches.length === 0 && (
              <p className="px-3 py-3 text-[13px] text-muted-foreground">
                {repos.length === 0 ? "No repositories found on this account." : "No match."}
              </p>
            )}
            {matches.map((r, i) => (
              <button
                key={r.fullName}
                type="button"
                data-idx={i}
                role="option"
                aria-selected={r.fullName === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r.fullName)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  i === active ? "bg-white/[0.06]" : ""
                }`}
              >
                <span className="truncate">{r.fullName}</span>
                {r.private && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" /> private
                  </span>
                )}
                {r.fullName === value && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-success" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
