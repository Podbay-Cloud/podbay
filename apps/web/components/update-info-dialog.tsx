"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { imageVersionLabel } from "@/lib/pod-image";

export interface ImageMeta {
  digest?: string | null;
  alias: string | null;
  notes: string | null;
  summary: string | null;
  version: string | null;
  sizeBytes: number | null;
  builtAt: string | null;
}

export interface UpdateInfo {
  targetDigest: string;
  currentDigest: string | null;
  target: ImageMeta | null;
  current: ImageMeta | null;
  /** Every build BETWEEN the pod's current image and the target, newest first
   * (target at index 0). Each carries its own git-derived notes, so a pod several
   * builds behind sees the full ladder of what it's catching up on. */
  images?: ImageMeta[];
}

/** Turn the recorded git-derived notes into display lines, and classify them so the
 * cockpit can summarise an update in a few words instead of "an update is ready".
 * Conventional-commit prefixes carry the area (feat(cockpit): …), which is exactly
 * the "what part of my pod changes?" the owner wants. */
/**
 * How a change reads to an OWNER. Conventional-commit types answer "what kind of work was this",
 * which is a developer question; an owner asks "is this a fix, something new, or a tune-up" — so the
 * types are mapped onto those three, and the ones that mean "internal churn" map to null and are
 * DROPPED. Every good changelog (Keep a Changelog, and every OS release-notes page) groups this way,
 * and it is the first thing a reader looks for when deciding whether to take an update.
 */
export type NoteKind = "fixed" | "new" | "improved";

const KIND_BY_TYPE: Record<string, NoteKind | null> = {
  fix: "fixed",
  revert: "fixed",
  feat: "new",
  perf: "improved",
  // Internal churn — real work, but nothing an owner can observe or act on. Shown, it crowds out the
  // entries that matter and leaks how the sausage is made ("the e2e 'flake' root cause" reached a
  // real release note on 2026-08-28).
  chore: null,
  test: null,
  ci: null,
  build: null,
  refactor: null,
  style: null,
  docs: null,
};

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  fixed: "Fixed",
  new: "New",
  improved: "Improved",
};

export function parseNotes(notes: string | null | undefined): {
  entries: { area: string | null; text: string; kind: NoteKind | null }[];
  areas: string[];
  empty: boolean;
  /** Raw lines existed, but every one was internal churn — so there is nothing to TELL the owner even
   * though the build is genuinely different. Distinct from `empty` (a byte-identical rebuild), because
   * conflating them would report "same software, rebuilt" about a build that is not that. */
  internalOnly: boolean;
} {
  const raw = (notes ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const empty =
    raw.length === 0 || (raw.length === 1 && /^No changes to what your pod runs/i.test(raw[0]));
  const AREA: Record<string, string> = {
    "pod-agent": "agent runtime",
    greeter: "agent runtime",
    handoff: "agent runtime",
    cockpit: "dashboard",
    web: "dashboard",
    dashboard: "dashboard",
    incus: "pod images",
    image: "pod images",
    "image-manifest": "pod images",
    boot: "pod startup",
    skills: "skills",
    "first-10": "playbook apps",
    env: "playbook apps",
    envs: "playbook apps",
  };
  const entries = raw.map((line) => {
    // Conventional-commit subjects are DEVELOPER text: "fix(pod-agent): added
    // agents get the REAL login flow, not a thinner copy". Shown verbatim they
    // read as noise and wrap around the prefix. Split the scope out as a label and
    // present the sentence on its own.
    const m = line.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
    let text = m ? m[3] : line;
    const area = m?.[2] ? (AREA[m[2]] ?? m[2]) : null;
    text = text
      .replace(/\s*\[(no-spec|skip ci)\]\s*/gi, "") // internal markers
      .replace(/\s+/g, " ")
      .trim();
    // Issue/PR refs are developer wayfinding and, worse, point at a PRIVATE repo — an owner who
    // follows "(#49)" lands on a 404. Drop them rather than publish a dead reference.
    text = text.replace(/\s*\((?:#|GH-)\d+\)\s*/g, " ").replace(/\s+/g, " ").trim();
    if (text) text = text[0].toUpperCase() + text.slice(1);
    // A subject with no conventional-commit type is either hand-written release copy or an old
    // commit; it stays, ungrouped, rather than being guessed into the wrong bucket.
    const kind = m?.[1] ? (KIND_BY_TYPE[m[1]] ?? null) : null;
    const internal = Boolean(m?.[1]) && KIND_BY_TYPE[m![1]] === null;
    return { area, text, kind, internal };
  });
  const shown = entries.filter((e) => !e.internal && e.text).map(({ area, text, kind }) => ({ area, text, kind }));
  const internalOnly = !empty && raw.length > 0 && shown.length === 0;
  const areas: string[] = [];
  for (const e of shown) if (e.area && !areas.includes(e.area)) areas.push(e.area);
  return { entries: shown, areas, empty, internalOnly };
}

/**
 * Render parsed entries GROUPED by what they mean to an owner (New → Fixed → Improved), the ordering
 * every mainstream release-notes page uses. A flat list forced the reader to infer the kind of each
 * change from its wording; grouping answers "is this worth taking" before they read a single entry.
 * Entries with no recognisable type keep their place at the end, ungrouped rather than mislabelled.
 */
export function NoteList({
  entries,
  size = "sm",
}: {
  entries: { area: string | null; text: string; kind: NoteKind | null }[];
  size?: "sm" | "md";
}) {
  const order: NoteKind[] = ["new", "fixed", "improved"];
  const groups = order
    .map((k) => ({ kind: k, items: entries.filter((e) => e.kind === k) }))
    .filter((g) => g.items.length > 0);
  const ungrouped = entries.filter((e) => !e.kind);
  const textCls = size === "md" ? "text-[13px] leading-snug" : "text-[12.5px] leading-snug text-muted-foreground";
  const item = (e: { area: string | null; text: string }, i: number) => (
    <li key={i} className="flex flex-col gap-0.5">
      {e.area && (
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{e.area}</span>
      )}
      <span className={textCls}>{e.text}</span>
    </li>
  );
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.kind} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {NOTE_KIND_LABEL[g.kind]}
          </span>
          <ul className="flex flex-col gap-2">{g.items.map(item)}</ul>
        </div>
      ))}
      {ungrouped.length > 0 && <ul className="flex flex-col gap-2">{ungrouped.map(item)}</ul>}
    </div>
  );
}

/** One-liner for the Settings row: "3 changes · the agent runtime, pod startup". */
export function updateSummaryLine(notes: string | null | undefined): string | null {
  const { entries, areas, empty, internalOnly } = parseNotes(notes);
  if (empty) return "Same software, rebuilt — nothing new for your pod";
  if (internalOnly) return "Internal improvements — nothing you need to do";
  // Lead with WHAT KIND of change this is ("2 fixes"), not a bare count: "1 change · agent runtime"
  // told an owner nothing about whether the update was worth taking (audit, 2026-08-29).
  const byKind = new Map<NoteKind, number>();
  for (const e of entries) if (e.kind) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const parts: string[] = [];
  if (byKind.get("fixed")) parts.push(`${byKind.get("fixed")} fix${byKind.get("fixed")! === 1 ? "" : "es"}`);
  if (byKind.get("new")) parts.push(`${byKind.get("new")} new`);
  if (byKind.get("improved")) parts.push(`${byKind.get("improved")} improvement${byKind.get("improved")! === 1 ? "" : "s"}`);
  const count = parts.length
    ? parts.join(", ")
    : `${entries.length} change${entries.length === 1 ? "" : "s"}`;
  return areas.length ? `${count} · ${areas.slice(0, 3).join(", ")}` : count;
}

/**
 * The user-facing one-liner for the Settings row / update prompt. Prefers the
 * HAND-WRITTEN `summary` (a "what's new for you", written from the owner's side)
 * over the git-commit changelog — the commit list is developer text, so it's the
 * fallback only when an image was recorded without a summary (older builds).
 * The summary's first line is used so a multi-sentence note still fits one row.
 */
export function updateHeadline(
  summary: string | null | undefined,
  notes: string | null | undefined,
): string {
  const s = summary?.trim().split("\n")[0]?.trim();
  if (s) return s;
  return updateSummaryLine(notes) ?? "An update is ready";
}

export function shortDigest(d: string | null): string {
  if (!d) return "unknown";
  return d.startsWith("sha256:") ? d.slice(7, 19) : d.slice(0, 12);
}

export function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtSize(bytes: number | null): string | null {
  if (!bytes) return null;
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * "What's in this update?" — the info button next to Update. Shows what the pod
 * runs now vs what it would update to, with the target image's release notes.
 * The notes are git-derived per image (recorded at build time); this modal only
 * reads them. When a build predates the manifest (no row), it says so rather than
 * showing an empty box.
 */
export function UpdateInfoDialog({
  info,
  onConfirm,
  confirmLabel = "Update and restart",
  warning,
  busy = false,
  trigger,
}: {
  info: UpdateInfo;
  /** Runs the update. Given, the dialog IS the confirm — there is no second one. */
  onConfirm?: () => void;
  confirmLabel?: string;
  /** Consequence callout (session interruption), rendered as its own block. */
  warning?: React.ReactNode;
  busy?: boolean;
  /** The control that opens it. Defaults to the ⓘ button for read-only callers. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { target, current } = info;
  const builtAt = fmtDate(target?.builtAt ?? null);
  const size = fmtSize(target?.sizeBytes ?? null);
  // One entry per build between current and target (newest first). Falls back to
  // the target alone when the range/manifest is unavailable, so the modal always
  // shows something.
  const allBuilds = (info.images && info.images.length > 0 ? info.images : target ? [target] : []).map(
    (img) => ({
      digest: img.digest ?? null,
      date: fmtDate(img.builtAt ?? null),
      summary: img.summary?.trim() || null,
      parsed: parseNotes(img.notes),
    }),
  );
  // Collapse builds whose owner-facing content is identical — a run of rebuilds carrying the SAME
  // note (e.g. two back-to-back CLI-pin bumps) should read as one change, not the same sentence
  // repeated (velsa, 2026-08-30). Keeps the newest occurrence's date/digest.
  const seenKeys = new Set<string>();
  const builds = allBuilds.filter((b) => {
    const key = `${b.summary ?? ""} ${b.parsed.entries.map((e) => e.text).join("")}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label="What's in this update?"
            title="What's in this update?"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          >
            <Info className="h-4 w-4" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle>What&rsquo;s in this update</DialogTitle>
          {/* Kept for a11y (aria-describedby) but visually hidden — the body's
              per-build summary already says what's new; a framing sentence here
              just repeated it. */}
          <DialogDescription className="sr-only">
            What this update changes, and what happens when you apply it.
          </DialogDescription>
        </DialogHeader>

        {/* What the owner actually needs: WHEN each build is from, in the same
            shape on both sides. This used to read "<12-char hash> → pod-base-
            20260729-0054", i.e. a hash turning into an internal build alias —
            which meant nothing to anyone outside this repo (owner, 2026-07-29).
            The date leads; the short id stays as a secondary, for support. */}
        <dl className="flex flex-col gap-1.5 text-[13px]">
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Running now</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span>{fmtDate(current?.builtAt ?? null) ?? "an older build"}</span>
              <span className="font-mono text-[12px] text-muted-foreground">
                {imageVersionLabel(current?.version, info.currentDigest)}
              </span>
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Updates to</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-warning">{builtAt ?? "the latest build"}</span>
              <span className="font-mono text-[12px] text-muted-foreground">
                {imageVersionLabel(target?.version, info.targetDigest)}
              </span>
              {size && <span className="text-[12px] text-muted-foreground">· {size}</span>}
            </dd>
          </div>
        </dl>

        <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1.5">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            What changes{builds.length > 1 ? ` · ${builds.length} builds` : ""}
          </p>
          {/* The changelog is the ONLY thing that scrolls: it flexes to fill the space
              between the fixed header/card above and the action footer below (which are
              flex-none), so the footer can never overlap or clip it. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {builds.length === 0 || builds.every((b) => b.parsed.empty && !b.summary) ? (
              <p className="py-3 text-[13px] text-muted-foreground">
                Nothing your pod runs has changed since your build — this is the same software,
                rebuilt. Updating is harmless but gains you nothing unless you&rsquo;re
                troubleshooting.
              </p>
            ) : (
              <ul className="flex flex-col">
                {builds.map((b, bi) => (
                  <li key={b.digest ?? bi} className="border-b border-border/40 py-3 first:pt-0 last:border-b-0">
                    {/* A build header only when there's MORE than one build to tell
                        apart — a single-build changelog needs no date divider. */}
                    {builds.length > 1 && (
                      <div className="mb-1.5 flex items-baseline gap-2 text-[11px]">
                        <span className="font-medium text-foreground/80">
                          {b.date ?? "a build"}
                        </span>
                        <span className="font-mono text-muted-foreground">{shortDigest(b.digest ?? null)}</span>
                      </div>
                    )}
                    {b.summary ? (
                      // Summary-only: the hand-written, user-facing "what's new for you". The
                      // git-commit changelog is developer text — an owner never needs it, so it is
                      // NOT surfaced here (velsa, 2026-08-30); it lives in git for support.
                      <p className="whitespace-pre-line text-[13px] leading-relaxed">{b.summary}</p>
                    ) : b.parsed.empty ? (
                      <p className="text-[12.5px] text-muted-foreground">Rebuild — nothing new to run.</p>
                    ) : (
                      // No hand-written summary (older images recorded before summaries
                      // were required) — fall back to the parsed commit changelog inline.
                      <NoteList entries={b.parsed.entries} size="md" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {onConfirm && (
          // Footer is a flex-none child below the flex-1 changelog, so Cancel/Update
          // always sit under the (scrolling) list — never overlapping it.
          <div className="-mx-6 -mb-6 flex flex-none flex-col gap-2 border-t border-border/60 bg-background px-6 pt-3 pb-6">
            {warning && (
              <p className="rounded-lg border border-warning/40 bg-warning/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-warning">
                {warning}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The static "what a pod update does" explainer — what's kept, what happens —
 * behind an ⓘ next to the Update button. Split out of the update modal so that modal
 * can stay short (just the changelog + confirm) and not overflow a phone screen. */
export function UpdateBasicsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="What does updating do?"
          title="What does updating do?"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <Info className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>What updating does</DialogTitle>
          <DialogDescription>The same for every update — what&rsquo;s kept, and what to expect.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 p-3 sm:flex-row sm:gap-2.5">
            <span className="w-24 shrink-0 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Kept
            </span>
            <span className="text-[13px] leading-relaxed text-muted-foreground">
              Your files in <code className="font-mono text-foreground">~/work</code>, your
              agent&rsquo;s plan and history, its sign-in, and your pod&rsquo;s secrets.
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 p-3 sm:flex-row sm:gap-2.5">
            <span className="w-24 shrink-0 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Happens
            </span>
            <span className="text-[13px] leading-relaxed text-muted-foreground">
              The pod hands its state off to a note for the next session, then restarts on the new
              image — the live conversation ends and your agent resumes from that note. Usually 2–3
              minutes (the hand-off alone can take a minute).
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
