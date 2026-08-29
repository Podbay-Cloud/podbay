"use client";

import { useEffect, useState, useTransition } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PodCard, { type PodCardProps, type PodCardLive } from "@/components/pod-card";
import { reorderPods, updateIdlePods } from "@/lib/actions";
import type { PodLiveSignals } from "@podbay/control-plane";
import { apiGet } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { BulkUpdateDialog, type BulkTargetImage } from "@/components/bulk-update-dialog";
import { RefreshCw } from "lucide-react";

/** Idle DWELL for the bulk button — a pod idle < this is skipped (a pause between turns, not
 * genuinely inactive). Must match IDLE_UPDATE_DWELL_MS in lib/actions.ts (the server re-checks). */
const IDLE_UPDATE_DWELL_MS = 10 * 60 * 1000;
/** Idle-by-inactivity floor for a pod whose agent status is UNKNOWN (null). Mirrors the control-plane
 * UNKNOWN_STATUS_IDLE_MS — a much longer "clearly abandoned" bar for a pod we can't confirm idle live. */
const UNKNOWN_STATUS_IDLE_MS = 4 * 60 * 60 * 1000;

/**
 * The dashboard's pod list with MANUAL drag-to-reorder (the grip is the only drag
 * target, so links/buttons keep working). A drop persists the complete order
 * server-side; the optimistic local order holds until the next server render
 * confirms it. No auto-grouping — the owner's hand order is the order.
 */

function SortableCard({ card }: { card: PodCardProps }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.slug,
  });
  return (
    <PodCard
      {...card}
      drag={{
        innerRef: setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
        handleProps: { ...attributes, ...listeners },
        dragging: isDragging,
      }}
    />
  );
}

export default function PodCardList({
  cards,
  bulkUpdate = false,
  targetImage = null,
}: {
  cards: PodCardProps[];
  /** Cloud-only: show the "Update N idle pods" bulk button (self-host updates are host-level). */
  bulkUpdate?: boolean;
  /** The current pod-base image (what eligible pods update TO) — for the bulk-update modal. */
  targetImage?: BulkTargetImage | null;
}) {
  const [order, setOrder] = useState(() => cards.map((c) => c.slug));
  // Live signals via react-query: fetched off the render path (the server no longer blocks on them),
  // cached (so navigating back here paints the cards' live state instantly), then polled. A pod
  // mid-transition (updating/waking/provisioning) polls FAST (~3s) so its card reflects the change
  // within a couple seconds; steady state polls slowly (10s). react-query pauses the interval while
  // the tab is hidden (refetchIntervalInBackground defaults off) — the old `!document.hidden` guard.
  const { data: live = {} } = useQuery({
    queryKey: qk.liveSignals(),
    // queryFn returns the RAW owner rows — the ONE canonical cache shape for qk.liveSignals (the
    // cockpit header reads the same key with its own select). The Record shape this list wants is
    // built in `select`, so the two consumers never fight over the cached value.
    queryFn: () => apiGet<PodLiveSignals[]>("/api/pods/live-signals"),
    select: (rows): Record<string, PodCardLive> => {
      const next: Record<string, PodCardLive> = {};
      for (const r of rows)
        next[r.id] = {
          status: r.status,
          updating: r.updating,
          agentStatus: r.agentStatus,
          codexStatus: r.codexStatus,
          agentWaitingFor: r.agentWaitingFor,
          agentIdleMs: r.agentIdleMs,
          agents: r.agents,
          appListening: r.appListening,
          criticalIssue: r.criticalIssue,
          unreachable: r.unreachable,
        };
      return next;
    },
    // Transition state is read from the freshest poll result first (so a transition the poll
    // detects speeds up subsequent polls), else the server-rendered status. `query.state.data` is the
    // raw (pre-select) rows.
    refetchInterval: (query) => {
      const byId = new Map((query.state.data ?? []).map((r) => [r.id, r]));
      const transitioning = cards.some((c) => {
        const l = byId.get(c.slug);
        return (
          ["updating", "waking", "provisioning", "destroying", "resizing"].includes(l?.status ?? c.status) ||
          l?.updating ||
          c.updating
        );
      });
      return transitioning ? 3_000 : 10_000;
    },
    placeholderData: keepPreviousData,
  });
  // Server refreshes (AutoRefresh) can add/remove/reorder pods — resync whenever
  // the incoming set differs from what we're showing.
  useEffect(() => {
    const incoming = cards.map((c) => c.slug);
    setOrder((cur) =>
      cur.length === incoming.length && cur.every((s) => incoming.includes(s)) ? cur : incoming,
    );
  }, [cards]);

  const sensors = useSensors(
    // A small activation distance keeps plain clicks (open the cockpit) from
    // starting a drag; touch holds briefly so scrolling still works on phones.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = new Map(cards.map((c) => [c.slug, { ...c, live: live[c.slug] ?? c.live ?? null }]));
  const ordered = order.map((s) => byId.get(s)).filter(Boolean) as PodCardProps[];

  // Bulk "update idle pods" (cloud-only). Client-side count for the button's visibility + label;
  // the server action re-derives eligibility from scratch (never trusts this list). Mirrors the
  // control-plane predicate: behind + running + not-updating + not-excluded + agent idle + dwell.
  const now = Date.now();
  const eligibleIdle = !bulkUpdate
    ? []
    : cards.filter((c) => {
        const l = live[c.slug];
        if (!c.updateReady || c.updating || l?.updating) return false;
        if ((l?.status ?? c.status) !== "running") return false;
        if (c.autoUpdate === "off") return false;
        if (c.t3Control) return false; // T3 drives the session — auto-update would interrupt it (excl. T3)
        // Keep in sync with control-plane updatableIdlePods.
        const anyBusy =
          l?.agentStatus === "busy" ||
          l?.agentStatus === "waiting" ||
          l?.agentStatus === "shell" ||
          l?.codexStatus === "busy";
        if (anyBusy) return false;
        // TRUE idle — the agent's session mtime (counts app/RC + autonomous turns), NOT lastActiveAt
        // (client-proxied traffic only). Fall back to lastActiveAt when the pod doesn't report idleMs.
        const idleMs =
          l?.agentIdleMs ?? (c.lastActiveAtIso ? now - Date.parse(c.lastActiveAtIso) : null);
        if (idleMs === null) return false;
        // Affirmatively idle for the dwell, OR unknown status (null) but clearly inactive for far longer.
        const someIdle = l?.agentStatus === "idle" || l?.codexStatus === "idle";
        const statusUnknown = l?.agentStatus == null && l?.codexStatus == null;
        return (
          (someIdle && idleMs >= IDLE_UPDATE_DWELL_MS) ||
          (statusUnknown && idleMs >= UNKNOWN_STATUS_IDLE_MS)
        );
      });
  const [bulkPending, startBulk] = useTransition();
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  // The pods the modal lists — name, current image (what they're leaving), and the agent's TRUE idle
  // time (session mtime), falling back to lastActiveAt only when the pod doesn't report it.
  const bulkPods = eligibleIdle.map((c) => {
    const l = live[c.slug];
    const idleMs = l?.agentIdleMs ?? (c.lastActiveAtIso ? now - Date.parse(c.lastActiveAtIso) : null);
    return { name: c.name?.trim() || c.slug, digest: c.imageDigest ?? null, idleMs };
  });

  // Auto-dismiss the "Updating N pods…" notice — it's an informational toast, not durable state. Left
  // to a plain setState it lingered until a page reload (owner, 2026-08-26); clear it once the updates
  // have had time to finish so it never sticks.
  useEffect(() => {
    if (!bulkMsg) return;
    const t = setTimeout(() => setBulkMsg(null), 30_000);
    return () => clearTimeout(t);
  }, [bulkMsg]);

  function confirmBulkUpdate() {
    setBulkMsg(null);
    startBulk(async () => {
      const r = await updateIdlePods();
      setBulkOpen(false);
      setBulkMsg(
        "error" in r
          ? r.error
          : r.started === 0
            ? "No idle pods were eligible just now."
            : `Updating ${r.started} pod${r.started === 1 ? "" : "s"} — each resumes in ~1 min.`,
      );
    });
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((cur) => {
      const next = arrayMove(cur, cur.indexOf(String(active.id)), cur.indexOf(String(over.id)));
      void reorderPods(next); // fire-and-forget; the next server render confirms
      return next;
    });
  };

  // Fleet reconnect summary — pods whose Claude/Codex login is expired or expiring within ~7 days, so
  // "N pods need me" reads at a glance instead of hunting the list (agent-auth-lifecycle).
  const RECONNECT_MS = 7 * 24 * 60 * 60 * 1000;
  const needReconnect = Object.values(live).filter((l) =>
    l.agents?.some(
      (a) =>
        a.loginExpired ||
        a.needsReauth ||
        (a.expiresAt != null && a.expiresAt > Date.now() && a.expiresAt - Date.now() < RECONNECT_MS),
    ),
  ).length;

  return (
    <>
      {needReconnect > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/35 bg-warning/[0.06] px-3 py-2 text-[12.5px] text-warning">
          <RefreshCw className="size-3.5 shrink-0" />
          {needReconnect} pod{needReconnect === 1 ? "" : "s"} need a reconnect — open the pod and use Reconnect
          in the Control tab.
        </div>
      )}
      <BulkUpdateDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        count={bulkPods.length}
        target={targetImage}
        pods={bulkPods}
        busy={bulkPending}
        onConfirm={confirmBulkUpdate}
      />
      {(eligibleIdle.length > 0 || bulkMsg) && (
        <div className="mb-3 flex items-center justify-end gap-3">
          {bulkMsg && <span className="text-[12.5px] text-muted-foreground">{bulkMsg}</span>}
          {eligibleIdle.length > 0 && (
            <Button variant="outline" size="sm" disabled={bulkPending} onClick={() => setBulkOpen(true)}>
              <RefreshCw className="mr-1.5 size-3.5" />
              {bulkPending
                ? "Starting…"
                : `Update ${eligibleIdle.length} idle pod${eligibleIdle.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-3">
            {ordered.map((c) => (
              <SortableCard key={c.slug} card={c} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
}
