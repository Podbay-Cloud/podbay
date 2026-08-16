"use server";

import { revalidatePath } from "next/cache";
import { createLogger } from "@podbay/shared/log";
import { requireAdmin } from "./access";
import { getPodService } from "./pod-service";

const log = createLogger("web");

type ActionResult = { error: string } | void;

function message(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/**
 * Backoffice pod control. Every action is gated by requireAdmin() and acts on
 * ANY pod regardless of owner (the control-plane resolves the real owner and
 * keeps events attributed to them, not the admin). Mirrors the owner-scoped
 * actions in ./actions.ts.
 */

export async function adminWakePod(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await getPodService().adminWake(id);
  } catch (e) {
    log.error("admin_wake_failed", { podId: id, err: e });
    return { error: message(e) };
  }
  revalidatePath("/admin/fleet");
}

export async function adminSleepPod(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await getPodService().adminSleep(id);
  } catch (e) {
    log.error("admin_sleep_failed", { podId: id, err: e });
    return { error: message(e) };
  }
  revalidatePath("/admin/fleet");
}

export async function adminDestroyPod(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await getPodService().adminDestroy(id);
  } catch (e) {
    log.error("admin_destroy_failed", { podId: id, err: e });
    return { error: message(e) };
  }
  revalidatePath("/admin/fleet");
}

/** Apply the currently-pinned base image to a pod (the fleet "update" control).
 * The image is read server-side from PODBAY_BASE_IMAGE — never from the client. */
export async function adminUpdatePod(id: string): Promise<ActionResult> {
  await requireAdmin();
  const image = process.env.PODBAY_BASE_IMAGE;
  if (!image) return { error: "No pod image is configured" };
  try {
    await getPodService().adminUpdatePodImage(id, image);
  } catch (e) {
    log.error("admin_update_pod_failed", { podId: id, err: e });
    return { error: message(e) };
  }
  revalidatePath("/admin/fleet");
}

/** Roll a pod back to the image it ran before its last update. The prior digest
 * is already recorded in the `updated` event's meta.from — no new persistence.
 * We rebuild a full image ref from the pinned base (registry/repo:tag@<prior>). */
export async function adminRollbackPod(id: string): Promise<ActionResult> {
  await requireAdmin();
  const base = process.env.PODBAY_BASE_IMAGE?.split("@")[0];
  if (!base) return { error: "No pod image is configured" };
  try {
    const svc = getPodService();
    const events = await svc.adminPodEvents(id);
    const lastUpdate = [...events].reverse().find((e) => e.type === "updated");
    const meta = (lastUpdate?.meta ?? {}) as { from?: unknown };
    const prior = typeof meta.from === "string" ? meta.from : null;
    if (!prior) return { error: "No previous version to roll back to" };
    await svc.adminUpdatePodImage(id, `${base}@${prior}`);
  } catch (e) {
    log.error("admin_rollback_failed", { podId: id, err: e });
    return { error: message(e) };
  }
  revalidatePath("/admin/fleet");
}

/** System reconcile of one pod against provider truth (settles status, refreshes
 * the session URL, backfills machineId/imageDigest). Already system-scoped. */
export async function adminReconcilePod(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await getPodService().reconcile(id);
  } catch (e) {
    log.error("admin_reconcile_failed", { podId: id, err: e });
    return { error: message(e) };
  }
  revalidatePath("/admin/fleet");
}

/** ADMIN-SCOPED metrics for the drill-in's charts. The owner-scoped action would
 * 404 here: an admin is not the pod's owner. */
export async function getAdminPodMetrics(
  id: string,
  windowMs?: number,
): Promise<import("@podbay/shared").MetricsSnapshot | null> {
  await requireAdmin();
  return getPodService()
    .adminPodMetrics(id, windowMs)
    .catch(() => null);
}

/**
 * Doctor, for an operator on someone else's pod.
 *
 * Deliberately narrower than the owner's: "check" and "safe" only, no invasive
 * mode. Replacing a user's files is a decision for the person whose files they
 * are — an operator can see the finding and tell them, or the owner can run the
 * invasive repair from their own cockpit. Enforced here AND in the control-plane
 * (adminRunDoctor's signature admits no third mode), because a UI that merely
 * hides the button is not an access control.
 */
export async function runAdminPodDoctor(
  id: string,
  mode: "check" | "safe",
): Promise<import("@podbay/provider").DoctorReport | { error: string }> {
  await requireAdmin();
  try {
    return await getPodService().adminRunDoctor(id, mode);
  } catch (e) {
    log.error("admin_doctor_failed", { podId: id, mode, err: e });
    return { error: message(e) };
  }
}

/**
 * Resize someone else's pod. Audited like every admin action — a size change moves
 * what the owner is billed, so it appears in their own activity list rather than
 * only in the operator's.
 */
export async function adminResizePod(id: string, size: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await getPodService().adminResize(id, size as never);
  } catch (e) {
    log.error("admin_resize_failed", { podId: id, size, err: e });
    return { error: message(e) };
  }
  revalidatePath(`/admin/pods/${id}`);
}

/**
 * Collect bounded diagnostics from a pod — the alternative to a shell.
 *
 * See the REPORT BOUNDARY in packages/provider/pod-base/podbay-doctor: named
 * sections describing the machine, never the user's content. Audited, so the owner
 * sees that support looked.
 */
export async function collectPodDiagnostics(
  id: string,
): Promise<import("@podbay/provider").DiagnosticReport | { error: string }> {
  await requireAdmin();
  try {
    return await getPodService().adminPodReport(id);
  } catch (e) {
    log.error("admin_report_failed", { podId: id, err: e });
    return { error: message(e) };
  }
}

/** The fleet's fetch-memory table, worst-behaved domains first. */
export async function getFetchMemory(): Promise<import("@podbay/control-plane").FetchMemoryRow[]> {
  await requireAdmin();
  const { FetchMemory } = await import("@podbay/control-plane");
  const { createAppDb } = await import("@podbay/db");
  return new FetchMemory(createAppDb()).all(300).catch(() => []);
}

/**
 * Force a re-check of a domain. Ages the verdict rather than deleting it — the counts
 * are what tell you a rung is flaky rather than dead, so "check again" must not mean
 * "forget what we saw".
 */
export async function reverifyFetchDomain(domain: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const { FetchMemory } = await import("@podbay/control-plane");
    const { createAppDb } = await import("@podbay/db");
    await new FetchMemory(createAppDb()).expire(domain);
  } catch (e) {
    log.error("fetch_memory_reverify_failed", { domain, err: e });
    return { error: message(e) };
  }
  revalidatePath("/admin/fetch-memory");
}
