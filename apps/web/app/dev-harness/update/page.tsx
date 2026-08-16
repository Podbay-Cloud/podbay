"use client";
// Dev-only visual harness for the update dialog (see ../preview/page.tsx for why
// this can't live under `_harness`). Renders it open with realistic notes so
// wrapping and balance can be checked at real widths — now with a multi-build range
// and a long changelog, to prove the modal caps its height and pins its footer.
import { UpdateInfoDialog, UpdateBasicsDialog } from "@/components/update-info-dialog";

const N = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

export default function Harness() {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <main className="flex items-center gap-2 p-6">
      <UpdateBasicsDialog />
      <UpdateInfoDialog
        warning="Stops any running agent session. Work in progress that isn't saved or committed can be lost — check the terminal first."
        onConfirm={() => {}}
        trigger={<button type="button" data-testid="open-update">Update</button>}
        info={{
          targetDigest: "8298d6135b5aef5ba05d31238c8a2e915228de440fa99d7bc8209f3ec248ddb4",
          currentDigest: "60a5bc7ca2931cdec5e7fa70b9daa19c850253ada38b7ab420125ed0bf0977b5",
          target: { digest: "8298d6135b5a", alias: null, notes: null, summary: null, sizeBytes: 3322444513, builtAt: "2026-08-02T02:10:00.000Z" },
          current: { digest: "60a5bc7ca293", alias: null, notes: null, summary: null, sizeBytes: 3300000000, builtAt: "2026-07-30T22:00:00.000Z" },
          images: [
            {
              digest: "8298d6135b5a", alias: null,
              // User-facing summary leads; the commit changelog collapses under it.
              summary:
                "Your pod's activity history now shows suspended time and crash markers, so you can see at a glance when it slept or restarted. Nothing you need to do — just clearer stats.",
              sizeBytes: 3322444513, builtAt: "2026-08-02T02:10:00.000Z",
              notes: N([
                "refactor(status): rename the sleeping status/event token to suspended",
                "feat(cockpit): two-state running/suspended history + crash markers",
                "fix(cockpit): real tick axis under each chart; drop preview row",
              ]),
            },
            {
              digest: "aa11bb22cc33", alias: null, summary: null, sizeBytes: 3310000000, builtAt: "2026-08-01T12:00:00.000Z",
              notes: N([
                "feat(relay): the policy layer — allowlist, rate caps, queueing, fail-closed",
                "feat(web-fetch): podbay fetch get — the ladder as one enforced command",
              ]),
            },
            {
              digest: "dd44ee55ff66", alias: null, summary: null, sizeBytes: 3305000000, builtAt: "2026-07-31T09:00:00.000Z",
              notes: N([
                "fix(pod-agent): added agents get the REAL login flow, not a thinner copy",
                "feat(observability): OOM detection, incident classifier, owner banner",
                "fix(boot): env .claude layer never seeded on Incus pods",
              ]),
            },
          ],
        }}
      />
    </main>
  );
}
