"use client";

import { useEffect, useState } from "react";
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
import { reorderPods, getOwnerLiveSignals } from "@/lib/actions";

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

export default function PodCardList({ cards }: { cards: PodCardProps[] }) {
  const [order, setOrder] = useState(() => cards.map((c) => c.slug));
  // Live signals fetched off the render path (the server no longer blocks on them),
  // then polled — so navigating here is instant and the cards fill in their live
  // state a beat later. Only while at least one pod is running.
  const [live, setLive] = useState<Record<string, PodCardLive>>({});
  // A pod mid-transition (updating/waking/provisioning) is polled FAST so the card
  // reflects it within a couple seconds; steady state polls slowly. The transitional
  // read comes from live state first (so a transition detected by the poll speeds up
  // subsequent polls), else the server-rendered status.
  const stateOf = (slug: string, fallback: string) => live[slug]?.status ?? fallback;
  const transitioning = cards.some((c) =>
    ["updating", "waking", "provisioning", "destroying", "resizing"].includes(stateOf(c.slug, c.status)) ||
    live[c.slug]?.updating ||
    c.updating,
  );
  useEffect(() => {
    let stop = false;
    const poll = () =>
      void getOwnerLiveSignals()
        .then((rows) => {
          if (stop) return;
          const next: Record<string, PodCardLive> = {};
          for (const r of rows)
            next[r.id] = {
              status: r.status,
              updating: r.updating,
              agentStatus: r.agentStatus,
              codexStatus: r.codexStatus,
              agentWaitingFor: r.agentWaitingFor,
              agents: r.agents,
              appListening: r.appListening,
              criticalIssue: r.criticalIssue,
              unreachable: r.unreachable,
            };
          setLive(next);
        })
        .catch(() => undefined);
    poll();
    const t = setInterval(() => {
      if (!document.hidden) poll();
    }, transitioning ? 3_000 : 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [transitioning]);
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

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((cur) => {
      const next = arrayMove(cur, cur.indexOf(String(active.id)), cur.indexOf(String(over.id)));
      void reorderPods(next); // fire-and-forget; the next server render confirms
      return next;
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-3">
          {ordered.map((c) => (
            <SortableCard key={c.slug} card={c} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
