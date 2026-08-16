import "server-only";
import { eq } from "drizzle-orm";
import { createAppDb, user as userTable } from "@podbay/db";

/**
 * The post-create "how it works" walkthrough is a PER-USER, once-ever thing — not
 * per-pod. It lives on the user row (`walkthrough_seen_at`) so that once the owner
 * has finished or skipped it on any pod, it never re-runs on a freshly created one.
 * (It used to be stored on the pod, which re-showed the tour on every new pod.)
 */

/** Whether this user has already seen (or skipped) the walkthrough. */
export async function hasSeenWalkthrough(userId: string): Promise<boolean> {
  const rows = await createAppDb()
    .select({ at: userTable.walkthroughSeenAt })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return rows[0]?.at != null;
}

/** Record that the user finished/skipped the walkthrough. Idempotent — only stamps
 * the first time so the "when" stays meaningful. */
export async function markWalkthroughSeenForUser(userId: string): Promise<void> {
  const db = createAppDb();
  const rows = await db
    .select({ at: userTable.walkthroughSeenAt })
    .from(userTable)
    .where(eq(userTable.id, userId));
  if (rows[0]?.at != null) return; // already stamped
  await db
    .update(userTable)
    .set({ walkthroughSeenAt: new Date() })
    .where(eq(userTable.id, userId));
}

/** Un-stamp so the walkthrough replays once (the "Replay walkthrough" affordance in
 * the cockpit Details tab). Next load shows it again; finishing re-stamps it. */
export async function resetWalkthroughForUser(userId: string): Promise<void> {
  await createAppDb()
    .update(userTable)
    .set({ walkthroughSeenAt: null })
    .where(eq(userTable.id, userId));
}
