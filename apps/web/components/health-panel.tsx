"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Info, Loader2, OctagonAlert, RotateCw, Wrench } from "lucide-react";
import type { PodIssue } from "@podbay/shared";
import { Button } from "@/components/ui/button";
import { runPodDoctor } from "@/lib/actions";
import { runAdminPodDoctor } from "@/lib/admin-pod-actions";

const TONE = {
  critical: { Icon: OctagonAlert, cls: "text-destructive" },
  warn: { Icon: AlertTriangle, cls: "text-warning" },
  info: { Icon: Info, cls: "text-muted-foreground" },
} as const;

/**
 * The full health picture, in Admin — everything the strip deliberately hides:
 * `info` findings, per-agent issues (which the cards show in their own language),
 * and the healthy state stated explicitly.
 *
 * Saying "no problems found" HERE is right, while saying it on the cockpit's happy
 * path would be noise: someone opening this panel asked the question, so silence
 * would read as "it didn't run".
 */
type Finding = PodIssue & { fixed?: boolean; invasive?: boolean };

/** What doctor returns per finding — the owner and admin actions agree on this
 * shape, so the panel maps one way for both. */
type DoctorFinding = {
  id: string;
  title: string;
  detail: string;
  severity: string;
  fixed?: boolean;
  invasive?: boolean;
  agent?: string;
};

export default function HealthPanel({
  slug,
  running,
  onConfirm,
  admin = false,
}: {
  slug: string;
  running: boolean;
  /** Operator view: reads through the admin-scoped action (the owner action 404s
   * on someone else's pod) and offers check + safe only — replacing a user's files
   * is a decision for the person whose files they are. */
  admin?: boolean;
  /** Opens the cockpit's confirm dialog — invasive repairs must be consented to
   * separately, never folded into "fix what's safe". */
  onConfirm?: (c: {
    title: string;
    message?: React.ReactNode;
    warning?: React.ReactNode;
    confirmLabel: string;
    run: () => void;
  }) => void;
}) {
  const [issues, setIssues] = useState<Finding[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Doctor is the ACTIVE check: it probes things /healthz can't see (a missing
   * runtime, a stale setup marker) and, with fix, repairs what is safe. */
  const doctor = useCallback(
    async (mode: "check" | "safe" | "invasive") => {
      mode === "check" ? setChecking(true) : setFixing(true);
      setError(null);
      const r =
        admin && mode !== "invasive"
          ? await runAdminPodDoctor(slug, mode)
          : await runPodDoctor(slug, mode);
      if ("error" in r) setError(r.error);
      else {
        setIssues(
          r.issues.map((i: DoctorFinding) => ({
            ...i,
            severity: (i.severity === "critical" ? "critical" : i.severity === "info" ? "info" : "warn") as PodIssue["severity"],
            fixable: !i.fixed,
          })),
        );
      }
      mode === "check" ? setChecking(false) : setFixing(false);
    },
    [slug, admin],
  );

  // Doctor on open, and doctor on demand — ONE source. The panel used to load the
  // pod's PASSIVE findings and then let "Run doctor" replace them with a DIFFERENT
  // check set, so the button appeared to clear a finding that came straight back on
  // the next page load (owner, 2026-07-29). Doctor now includes /healthz's
  // findings, so both paths agree by construction.
  useEffect(() => {
    if (running) void doctor("check");
    else setIssues(null);
  }, [running, doctor]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">
          {!running
            ? "The pod isn’t running, so it can’t report on itself."
            : issues === null
              ? "Checking…"
              : issues.length === 0
                ? "Doctor found no problems."
                : `${issues.length} finding${issues.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!running || checking || fixing}
            onClick={() => void doctor("check")}
          >
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
            Run doctor
          </Button>
          {issues && issues.some((i) => i.fixable && !i.invasive) && (
            <Button size="sm" disabled={!running || fixing} onClick={() => void doctor("safe")}>
              {fixing ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
              Fix what&apos;s safe
            </Button>
          )}
          {/* Replacing files gets its OWN consent, with the consequence stated —
              a "fix what's safe" button must never quietly overwrite anything. */}
          {issues && issues.some((i) => i.fixable && i.invasive) && onConfirm && !admin && (
            <Button
              variant="outline"
              size="sm"
              disabled={!running || fixing}
              onClick={() =>
                onConfirm({
                  title: "Repair by replacing files?",
                  message: (
                    <>
                      This replaces{" "}
                      {issues
                        .filter((i) => i.fixable && i.invasive)
                        .map((i) => i.title.toLowerCase())
                        .join(" and ")}
                      . Your work in <code className="font-mono">~/work</code> is never touched.
                    </>
                  ),
                  warning: (
                    <>
                      The existing files are kept alongside as{" "}
                      <code className="font-mono">&lt;name&gt;.broken-&lt;timestamp&gt;</code>, so
                      nothing is destroyed — but the pod uses the fresh copies from here on.
                    </>
                  ),
                  confirmLabel: "Replace and repair",
                  run: () => void doctor("invasive"),
                })
              }
            >
              Repair (replaces files)
            </Button>
          )}
        </div>
      </div>

      {running && issues !== null && issues.length === 0 && (
        <p className="flex items-center gap-2 text-[13px] text-success">
          <Check className="size-4 shrink-0" />
          Session alive, agents running, disk healthy.
        </p>
      )}

      {error && <p className="text-[12.5px] text-destructive">{error}</p>}

      {issues?.map((i) => {
        const { Icon, cls } = TONE[i.severity];
        return (
          <div key={i.id} className="flex items-start gap-2.5 rounded-lg border border-border/60 p-3">
            <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} />
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">{i.title}</span>
              <span className="text-[12.5px] leading-relaxed text-muted-foreground">{i.detail}</span>
              <span className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground/70">
                {i.id}
                {i.fixed && <span className="text-success">fixed</span>}
                {!i.fixed && i.invasive && <span className="text-warning">replaces files</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
