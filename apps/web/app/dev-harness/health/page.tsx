// Dev-only visual harness for the health strip severities (see ../preview for why
// it can't live under `_harness`). Renders the strip's markup with fixture issues,
// including the healthy case, which must render NOTHING.
import { notFound } from "next/navigation";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import type { PodIssue } from "@podbay/shared";

export const dynamic = "force-static";

const CASES: { label: string; issues: PodIssue[] }[] = [
  { label: "healthy — must render nothing", issues: [] },
  {
    label: "warn",
    issues: [
      {
        id: "disk-low",
        severity: "warn",
        title: "Disk is running low",
        detail: "Under 15% free on the pod's home volume.",
        fixable: true,
      },
    ],
  },
  {
    label: "critical",
    issues: [
      {
        id: "repair-gave-up:claude-code",
        severity: "critical",
        title: "Podbay couldn’t restart Claude",
        detail:
          "It was restarted several times and kept failing, so Podbay stopped retrying. Updating or restarting the pod usually clears it.",
        fixable: false,
      },
      {
        id: "disk-critical",
        severity: "critical",
        title: "This pod is almost out of disk",
        detail: "Under 5% free — installs, builds and even repairs will start failing.",
        fixable: true,
      },
    ],
  },
];

function Strip({ issues }: { issues: PodIssue[] }) {
  const shown = issues.filter((i) => i.severity !== "info" && !i.agent);
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">(nothing rendered)</p>;
  const critical = shown.some((i) => i.severity === "critical");
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-xl border px-4 py-3 ${
        critical ? "border-destructive/50 bg-destructive/[0.06]" : "border-warning/50 bg-warning/[0.06]"
      }`}
    >
      {shown.map((i) => (
        <div key={i.id} className="flex items-start gap-2.5">
          {i.severity === "critical" ? (
            <OctagonAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium">{i.title}</span>
            <span className="text-[12.5px] leading-relaxed text-muted-foreground">{i.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Harness() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      {CASES.map((c) => (
        <section key={c.label} className="flex flex-col gap-2">
          <h2 className="text-[12px] uppercase tracking-wide text-muted-foreground">{c.label}</h2>
          <Strip issues={c.issues} />
        </section>
      ))}
    </main>
  );
}
