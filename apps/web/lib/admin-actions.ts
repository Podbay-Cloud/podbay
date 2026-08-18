"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createAppDb, user as userTable } from "@podbay/db";
import { sendApprovalEmail } from "@podbay/auth";
import { requireAdmin } from "./access";
import {
  pinExperimentVariant,
  stopExperiment,
} from "./landing-experiment-store";
import { ACTIVE_LANDING_EXPERIMENT } from "./landing-experiment-config";

export async function approveUser(userId: string): Promise<void> {
  await requireAdmin();
  const db = createAppDb();
  // Email ONLY on the unapproved→approved transition — re-approving an already-approved user
  // (or an idempotent double-click) must not spam them. Read first, then send only if it flips.
  const [before] = await db
    .select({ approved: userTable.approved, email: userTable.email, name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId));
  // Approving also clears any "Later" hold — an approved user is no longer a set-aside request.
  await db.update(userTable).set({ approved: true, deferredAt: null }).where(eq(userTable.id, userId));
  if (before && !before.approved) {
    // Best-effort: never let the "you're in" email fail the approval itself.
    await sendApprovalEmail({ name: before.name, email: before.email });
  }
  revalidatePath("/admin");
}

export async function revokeUser(userId: string): Promise<void> {
  await requireAdmin();
  await createAppDb().update(userTable).set({ approved: false }).where(eq(userTable.id, userId));
  revalidatePath("/admin");
}

/** "Later": set a pending access request aside to revisit, without approving or rejecting it.
 * It leaves the pending list and moves to the Later tab. No email is sent. */
export async function deferUser(userId: string): Promise<void> {
  await requireAdmin();
  await createAppDb().update(userTable).set({ deferredAt: new Date() }).where(eq(userTable.id, userId));
  revalidatePath("/admin");
}

/** Move a "Later" request back into the pending queue. */
export async function undeferUser(userId: string): Promise<void> {
  await requireAdmin();
  await createAppDb().update(userTable).set({ deferredAt: null }).where(eq(userTable.id, userId));
  revalidatePath("/admin");
}

export async function stopLandingExperiment(experimentId: string): Promise<void> {
  const admin = await requireAdmin();
  if (experimentId !== ACTIVE_LANDING_EXPERIMENT.id) {
    throw new Error("Historical landing experiments are read-only");
  }
  await stopExperiment(admin.id, experimentId);
  revalidatePath("/admin/experiments");
  revalidatePath(`/admin/experiments/${experimentId}`);
  revalidatePath("/");
}

export async function pinLandingExperiment(
  experimentId: string,
  variant: string,
): Promise<void> {
  const admin = await requireAdmin();
  if (experimentId !== ACTIVE_LANDING_EXPERIMENT.id) {
    throw new Error("Historical landing experiments are read-only");
  }
  await pinExperimentVariant(admin.id, experimentId, variant);
  revalidatePath("/admin/experiments");
  revalidatePath(`/admin/experiments/${experimentId}`);
  revalidatePath("/");
}
