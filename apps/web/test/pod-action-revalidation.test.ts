import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Every pod-scoped action must revalidate the COCKPIT route, not just /dashboard.
 *
 * Missing it is invisible in review and loud in use: the action succeeds, the server data
 * changes, and the page the user is looking at keeps rendering the old value because its route
 * was never invalidated — `router.refresh()` re-fetches a route Next still considers fresh.
 * Found via e2e: clicking Suspend left the badge reading "Running" across five polls.
 */
const src = readFileSync(path.join(process.cwd(), "lib/actions.ts"), "utf8");

/** Actions whose UI lives on /dashboard/pods/[slug]. */
const POD_SCOPED = [
  "sleepPod", "wakePod", "resizePod", "retryPod", "renamePod", "setLifecycle",
  "setPodPreviewPublic", "setPodSecret", "clearPodSecret", "dismissPodIncident",
];

function bodyOf(fn: string): string {
  const start = src.indexOf(`export async function ${fn}(`);
  expect(start, `${fn} not found in actions.ts`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("pod actions revalidate the page the user is on", () => {
  it.each(POD_SCOPED)("%s revalidates the cockpit route", (fn) => {
    const body = bodyOf(fn);
    expect(body, `${fn} revalidates /dashboard but not the pod page`).toContain(
      "revalidatePath(`/dashboard/pods/${slug}`)",
    );
  });

  it("revalidates on the ERROR path too, where it matters most", () => {
    // A failed suspend can still have moved server state; leaving the cockpit stale then
    // shows a pod that looks fine next to an error message contradicting it.
    const body = bodyOf("sleepPod");
    const inCatch = body.slice(body.indexOf("catch"), body.indexOf("return { error"));
    expect(inCatch).toContain("revalidatePath(`/dashboard/pods/${slug}`)");
  });
});
