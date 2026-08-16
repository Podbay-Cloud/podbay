"use server";

import { classifyEvent, SEVERITY_RANK, type Severity } from "@podbay/control-plane";
import { requireUser } from "./session";
import { getPodService } from "./pod-service";
import { dedupeRestartNoise } from "./activity-dedup";

/**
 * A pod event dressed for the cockpit: the raw row plus its classification (severity, a
 * plain-language title, whether it recommends an action). Classification runs SERVER-side
 * because classifyEvent lives in the server-only control-plane; the client just renders.
 */
export interface ActivityEvent {
  id: string;
  type: string;
  at: string;
  meta: Record<string, unknown> | null;
  severity: Severity;
  title: string;
  unplanned: boolean;
  action?: { kind: "resize"; reason: string };
  /** Server-side dismissal of this event's banner (durable, cross-device). */
  dismissedAt?: string | null;
}

export interface PodActivity {
  events: ActivityEvent[];
  /** The one incident worth a banner: the most recent unplanned warn/critical still
   * fresh (last 24h). Null when the pod has been quiet. */
  banner: ActivityEvent | null;
}

const FRESH_MS = 24 * 60 * 60 * 1000;

/** The owner's pod activity — classified events (newest first) + a banner incident. */
export async function getPodActivity(slug: string): Promise<PodActivity | { error: string }> {
  const user = await requireUser();
  try {
    const raw = await getPodService().podEvents(user.id, slug);
    const events: ActivityEvent[] = raw
      .map((e) => {
        const inc = classifyEvent(e.type, e.meta);
        return {
          id: e.id,
          type: e.type,
          at: e.at,
          meta: e.meta,
          severity: inc.severity,
          title: inc.title,
          unplanned: inc.unplanned,
          action: inc.action,
          dismissedAt: e.dismissedAt ?? null,
        };
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    const deduped = dedupeRestartNoise(events);

    const now = Date.now();
    const banner =
      deduped.find(
        (e) =>
          e.unplanned &&
          !e.dismissedAt && // owner dismissed it → stays gone (server-side, cross-device)
          SEVERITY_RANK[e.severity] >= SEVERITY_RANK.warn &&
          now - new Date(e.at).getTime() < FRESH_MS,
      ) ?? null;

    return { events: deduped, banner };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "could not load activity" };
  }
}
