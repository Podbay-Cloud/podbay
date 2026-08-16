"use client";

import { useState, useTransition, type CSSProperties, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, AlertTriangle, GripVertical, Lock } from "lucide-react";
import { wakePod, retryPod, destroyPod } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/pod-status";
import { AgentLogo } from "@/components/agent-logo";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";

/**
 * The dashboard "signal card" (B2, 2026-08-16): state-first, VERTICAL layout. A colour
 * SPINE down the left edge carries the pod's urgency so a stack of cards scans as a
 * colour column; the header pairs the name with a state pill; the agent's own activity
 * is written in words on its own line; then a divider and a FOOTER hold the preview
 * status (truthful about :3000) on the left and the actions on the right. A live-critical
 * problem rides a ribbon across the top. Ordering is MANUAL (drag the grip).
 */

/** Live signals for one pod, serialized from control-plane PodLiveSignals. All fields
 * degrade to null/absent when the pod didn't answer or runs an older image — the card
 * then renders from lifecycle status alone and CLAIMS nothing live. */
export interface PodCardLive {
  /** Server lifecycle status at poll time — keeps the card's status current between
   * full page reloads (e.g. an update starting shows within a poll). */
  status?: string;
  updating?: boolean;
  agentStatus: string | null;
  /** Codex activity (`busy` | `idle` | null) from its rollout-log mtime. */
  codexStatus?: string | null;
  agentWaitingFor: string | null;
  agents: { id: string; authed: boolean }[];
  appListening: boolean | null;
  criticalIssue: { title: string; detail: string } | null;
  unreachable: boolean;
}

export interface PodCardProps {
  slug: string;
  name: string | null;
  environmentTitle: string;
  status: string;
  agoLabel: string;
  previewPublic: boolean;
  previewUrl: string | null;
  hasSecrets?: boolean;
  lifecycle?: string;
  lifecycleLocked?: boolean;
  authedAt?: string | null;
  sessionUrl?: string | null;
  updateReady?: boolean;
  updating?: boolean;
  canRetry?: boolean;
  podAgents?: string[];
  /** Codex devices the owner confirmed pairing for — listed on the card like the pod page. */
  codexDevices?: { name: string; at: string }[];
  live?: PodCardLive | null;
}

/** Drag plumbing injected by the sortable list — the card stays renderable without it. */
export interface PodCardDrag {
  innerRef?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  handleProps?: Record<string, unknown>;
  dragging?: boolean;
}

/** One visual state for the spine + pill, derived from lifecycle + live signals. */
function deriveState(
  status: string,
  updating: boolean,
  live: PodCardLive | null | undefined,
  hasClaude: boolean,
): {
  spine: string;
  chip: { label: string; className: string; dot: string; pulse?: boolean } | null; // null → lifecycle badge
  activity: { text: string; dot: string } | null; // the agent line, in words
  ribbon: string | null;
} {
  const NEED = { chip: "border-warning/45 bg-warning/10 text-warning", dot: "bg-warning" };
  const WORK = { chip: "border-success/40 bg-success/10 text-success", dot: "bg-success" };
  const WAIT = { chip: "border-sky-400/35 bg-sky-400/10 text-sky-400", dot: "bg-sky-400" };
  const IDLE = { chip: "border-border bg-white/[0.04] text-muted-foreground", dot: "bg-muted-foreground/70" };
  const BAD = { chip: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" };

  if (status === "running" && !updating && live) {
    if (live.unreachable)
      return {
        spine: "bg-destructive",
        chip: { label: "Unreachable", className: BAD.chip, dot: BAD.dot },
        activity: null,
        ribbon: "The pod isn't answering — it reports as running but its agent can't be reached",
      };
    const ribbon = live.criticalIssue ? live.criticalIssue.title : null;
    const spineFor = (base: string) => (ribbon ? "bg-destructive" : base);
    // agentStatus/agentWaitingFor is CLAUDE's activity signal — never apply it to a
    // Codex-only pod (which has none). Such a pod gets a green "running" spine and no
    // activity chip; the codexChip in the render carries its (pairing) state instead.
    if (!hasClaude) return { spine: spineFor("bg-success/60"), chip: null, activity: null, ribbon };
    const dialog = typeof live.agentWaitingFor === "string" && /dialog/i.test(live.agentWaitingFor);
    if (dialog)
      return {
        spine: spineFor("bg-warning"),
        chip: { label: "Needs you", className: NEED.chip, dot: NEED.dot, pulse: true },
        activity: { text: "asking to approve a command", dot: NEED.dot },
        ribbon,
      };
    switch (live.agentStatus) {
      // `shell` (the agent running a shell command) IS working — fold it into busy so
      // it's green "Working", not a separate sky state that collided with "Waiting".
      case "busy":
      case "shell":
        return {
          spine: spineFor("bg-success"),
          chip: { label: "Working", className: WORK.chip, dot: WORK.dot, pulse: true },
          activity: { text: "working", dot: WORK.dot },
          ribbon,
        };
      case "waiting":
        return {
          spine: spineFor("bg-sky-400"),
          chip: { label: "Waiting for you", className: WAIT.chip, dot: WAIT.dot },
          activity: { text: "waiting for your reply", dot: WAIT.dot },
          ribbon,
        };
      case "idle":
        return {
          // Idle = running but quiet — a VISIBLE soft grey (was too dim, read as
          // suspended). Suspended (below) gets the dimmer tone; the two are swapped.
          spine: spineFor("bg-[#526079]"),
          chip: { label: "Idle", className: IDLE.chip, dot: IDLE.dot },
          activity: { text: "idle", dot: IDLE.dot },
          ribbon,
        };
      default:
        return { spine: spineFor("bg-success/50"), chip: null, activity: null, ribbon };
    }
  }
  // Not running with usable live signals: lifecycle drives the card. The spine tone
  // MIRRORS StatusDot's tones (pod-status.tsx) so the card and the pod page agree — and
  // an in-flight update is AMBER while a suspended pod is muted grey, never the same.
  if (updating) return { spine: "bg-warning", chip: null, activity: null, ribbon: null };
  const spine =
    status === "error" || status === "gone"
      ? "bg-destructive"
      : status === "suspended"
        ? "bg-border" // dim/off — resting, and dimmer than idle (swapped per feedback)
        : status === "running"
          ? "bg-success/60"
          : "bg-warning"; // provisioning / waking / destroying
  return { spine, chip: null, activity: null, ribbon: null };
}

export default function PodCard({
  slug,
  name,
  environmentTitle,
  status: serverStatus,
  agoLabel,
  previewUrl,
  previewPublic,
  authedAt = null,
  sessionUrl = null,
  updateReady = false,
  updating: serverUpdating = false,
  canRetry = true,
  podAgents = [],
  codexDevices = [],
  live = null,
  drag,
}: PodCardProps & { drag?: PodCardDrag }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const display = name?.trim() || slug;
  // Lifecycle from the live poll when we have it (keeps the card current between full
  // reloads — an update starting reflects on the next poll), else the server-rendered
  // prop. ALWAYS a server value, never local UI state.
  const status = live?.status ?? serverStatus;
  const updating = live?.updating ?? serverUpdating;
  const onboarding = !authedAt && !sessionUrl;
  const reachable = status === "running" && !updating;
  const href = `/dashboard/pods/${slug}`;

  // WHICH agents the pod runs comes from the DURABLE list (podAgents), never from the
  // live health probe — a mid-update probe can transiently report only one agent, which
  // made the card drop Claude until a refresh. live.agents is used only for per-agent auth.
  const agents = podAgents.length ? podAgents : (live?.agents?.map((a) => a.id) ?? []);
  const hasClaude = agents.includes("claude-code") || agents.length === 0;
  const state = deriveState(status, updating, live, hasClaude);

  // Codex activity, derived on the pod from its rollout-log mtime (busy/idle). Codex now
  // gets the SAME vocabulary as Claude — Working / Idle — instead of a bare "Running" or
  // a separate "Paired/Ready" (pairing already shows on the Codex line as device pills).
  const codexStatus = live?.codexStatus ?? null;
  const codexChip =
    reachable && !onboarding && !hasClaude && agents.includes("codex")
      ? codexStatus === "busy"
        ? { label: "Working", className: "text-success bg-success/12" }
        : { label: "Idle", className: "text-muted-foreground bg-white/[0.05]" }
      : null;

  // Preview truth, three-valued: known-live → offer the button; known-empty → NO button
  // (the footer line says "No app on :3000"); unknown (older image / not running) →
  // offer it, claiming nothing.
  const previewKnown = reachable && live != null && live.appListening != null;
  const previewLive = previewKnown && live!.appListening === true;
  const showPreviewEnabled = previewUrl && reachable && (previewKnown ? previewLive : true);

  // The footer's action cluster depends on the pod's lifecycle state.
  const runAction = (fn: () => Promise<{ error?: string } | void>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  };

  let actions: ReactNode;
  if (status === "error" || status === "gone") {
    actions = (
      <>
        {status === "error" && canRetry && (
          <Button variant="outline" size="sm" className="h-9" disabled={pending} onClick={() => runAction(() => retryPod(slug))}>
            {pending ? "…" : "Try again"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-9" disabled={pending} onClick={() => runAction(() => destroyPod(slug))}>
          Delete
        </Button>
      </>
    );
  } else if (status === "destroying") {
    actions = null;
  } else if (onboarding) {
    actions = (
      <>
        <Button asChild size="sm" className="h-9">
          <Link href={href}>Finish setup</Link>
        </Button>
        <Button variant="outline" size="sm" className="h-9" disabled={pending} onClick={() => runAction(() => destroyPod(slug))}>
          {pending ? "…" : "Cancel"}
        </Button>
      </>
    );
  } else {
    actions = (
      <>
        {/* No Preview button when nothing serves :3000 — the "No app on :3000" line in
            the footer says why, without a dead/disabled control. */}
        {showPreviewEnabled && (
          <Button asChild variant="outline" size="sm" className="h-9">
            <a href={previewUrl!} target="_blank" rel="noopener">
              Preview <ArrowUpRight />
            </a>
          </Button>
        )}
        {/* Resume only when genuinely suspended — NOT mid-update (an update briefly
            reads "suspended" on the row while the pod recreates; showing Resume then was
            a bug). */}
        {status === "suspended" && !updating && (
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={pending}
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Resume ${display}?`,
                  message: "It starts using compute again and counts toward your slots.",
                  confirmLabel: "Resume",
                }))
              )
                return;
              runAction(() => wakePod(slug));
            }}
          >
            {pending ? "Resuming…" : "Resume"}
          </Button>
        )}
        {/* Primary "Open in Claude" jumps into the session (agent-marked). Codex-only
            pods have NO app shortcut and no separate "Open pod" button — clicking the
            card already opens the cockpit. */}
        {sessionUrl && reachable && (
          <Button asChild size="sm" className="h-9">
            <a href={sessionUrl} target="_blank" rel="noopener noreferrer">
              <AgentLogo agent="claude-code" className="size-[15px] rounded-[4px]" />
              Open <ArrowUpRight />
            </a>
          </Button>
        )}
      </>
    );
  }

  // The footer's left side: preview truth (running pods that report it) — else nothing.
  // A lock when the preview is owner-only (matches the cockpit's preview card).
  const previewStatus = previewKnown ? (
    previewLive ? (
      // Live: a green dot (+ lock if owner-only) — the "Preview" button beside it says
      // the rest, so no long label to crowd the buttons off the line on a phone.
      <span className="flex items-center gap-1.5" title="Preview live on :3000">
        <span className="size-1.5 shrink-0 rounded-full bg-success shadow-[0_0_5px_rgba(52,211,153,0.6)]" aria-hidden />
        <span className="hidden sm:inline">Preview&nbsp;:3000</span>
        {!previewPublic && <Lock className="size-3 shrink-0 text-muted-foreground/80" aria-label="Only you" />}
      </span>
    ) : (
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full border border-muted-foreground/60" aria-hidden />
        No app on :3000
      </span>
    )
  ) : null;

  const codexAuthed = live?.agents?.find((a) => a.id === "codex")?.authed ?? true;

  return (
    <li
      ref={drag?.innerRef}
      style={drag?.style}
      data-testid="pod-card"
      className={cn(
        "relative cursor-pointer overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/55 has-[a:focus-visible]:border-primary",
        drag?.dragging && "z-10 opacity-90 shadow-2xl",
        state.ribbon && "border-destructive/40",
      )}
    >
      {/* Urgency spine — the state as a colour, readable before any word. */}
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", state.spine)} />

      {state.ribbon && (
        <div className="relative z-[1] flex items-center gap-2 border-b border-destructive/25 bg-destructive/10 py-1.5 pl-[18px] pr-4 text-[12px] font-medium text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{state.ribbon}</span>
        </div>
      )}

      <Link
        href={href}
        aria-label={`Open ${display}`}
        draggable={false}
        className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />

      {/* pointer-events-none so a click anywhere on the card body falls THROUGH to the
          Link overlay above (open the cockpit); the grip and footer re-enable events for
          drag + buttons. Without this the wrapper sat over the Link and swallowed clicks. */}
      <div className="pointer-events-none relative z-[1] flex gap-2.5 px-[18px] py-4">
        {/* Drag grip — the pointer target that reorders; everything else opens. A
            comfortable hit area (touch) and a visible resting colour so it reads as
            "drag me", not decoration. */}
        <button
          type="button"
          aria-label={`Reorder ${display}`}
          {...(drag?.handleProps ?? {})}
          className={cn(
            "pointer-events-auto relative z-[2] -ml-1.5 -mt-0.5 flex h-8 w-6 shrink-0 cursor-grab touch-none items-start justify-center rounded pt-1 text-muted-foreground/70 hover:bg-white/[0.06] hover:text-foreground active:cursor-grabbing",
            !drag && "invisible",
          )}
        >
          <GripVertical className="size-4" />
        </button>

        <div className="pointer-events-none min-w-0 flex-1">
          {/* Header: name (+ update badge) on the left, state pill on the right. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="break-words text-[15.5px] font-semibold">{display}</span>
              {!updating && updateReady && (
                <span className="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                  Update available
                </span>
              )}
            </div>
            {state.chip ? (
              <span
                data-testid="pod-status"
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold",
                  state.chip.className,
                )}
              >
                {state.chip.pulse && <span className={cn("size-1.5 animate-pulse rounded-full", state.chip.dot)} aria-hidden />}
                {state.chip.label}
              </span>
            ) : codexChip ? (
              <span
                data-testid="pod-status"
                title="Codex activity (inferred from its rollout log)"
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full border border-transparent px-2.5 py-0.5 text-[11.5px] font-semibold",
                  codexChip.className,
                )}
              >
                {codexChip.label}
              </span>
            ) : (
              <StatusBadge status={updating ? "updating" : status} />
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{environmentTitle}</span>
            <span>· active {agoLabel}</span>
          </div>

          {/* Agent line(s): who's doing what, in words. */}
          {reachable && (state.activity || agents.includes("codex")) && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {hasClaude && state.activity && (
                <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <AgentLogo agent="claude-code" className="size-[15px] rounded-[4px]" />
                  <span className="font-medium text-foreground/90">Claude</span>
                  <span className={cn("size-1.5 rounded-full", state.activity.dot)} aria-hidden />
                  {state.activity.text}
                </span>
              )}
              {agents.includes("codex") && (
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
                  <AgentLogo agent="codex" className="size-[15px] rounded-[4px]" />
                  <span className="font-medium text-foreground/90">Codex</span>
                  {/* Activity (from the rollout log) when known, then paired devices as
                      inline PILLS on the same line (like the pod page). */}
                  {codexStatus && (
                    <>
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          codexStatus === "busy" ? "bg-success" : "bg-muted-foreground/70",
                        )}
                        aria-hidden
                      />
                      {codexStatus === "busy" ? "working" : "idle"}
                    </>
                  )}
                  {codexDevices.length > 0 ? (
                    codexDevices.map((d) => (
                      <span
                        key={`${d.name}-${d.at}`}
                        className="rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[11.5px] text-foreground/80"
                      >
                        {d.name}
                      </span>
                    ))
                  ) : (
                    <span>· {codexAuthed ? "no devices paired yet" : "not signed in yet"}</span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Divider + footer: preview truth on the left (truncates), actions pinned
              right. NO wrap — on a phone the status shrinks rather than dropping the
              buttons onto a second, left-aligned line. */}
          {actions && (
            <div className="pointer-events-auto relative z-[2] mt-3.5 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
              <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">{previewStatus}</span>
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            </div>
          )}
          {error && (
            <p className="pointer-events-auto relative z-[2] mt-2 truncate text-xs text-destructive" title={error}>
              {error}
            </p>
          )}
        </div>
      </div>
      {dialog}
    </li>
  );
}
