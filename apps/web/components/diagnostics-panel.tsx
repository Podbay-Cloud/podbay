"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collectPodDiagnostics } from "@/lib/admin-pod-actions";
import type { DiagnosticReport } from "@podbay/provider";

/**
 * Bounded diagnostics for support, instead of a terminal on someone else's pod.
 *
 * The sections are NAMED and shown in full, which is the whole point: an
 * unlabelled dump would be indistinguishable from a shell, and the argument for
 * this over a shell rests on a reader being able to see exactly what was taken.
 * The boundary lives in pod-base/podbay-doctor and is restated here because the
 * person clicking the button is the one who should know it.
 */
export default function DiagnosticsPanel({ id, running }: { id: string; running: boolean }) {
  // useMutation owns the collect action's busy/error/result state — a reject now surfaces the error
  // and resets the button instead of leaving the spinner stuck on "Collect".
  const collect = useMutation({
    mutationFn: async (): Promise<DiagnosticReport> => {
      const r = await collectPodDiagnostics(id);
      if ("error" in r) throw new Error(r.error);
      return r;
    },
  });
  const report = collect.data ?? null;
  const busy = collect.isPending;
  const error = collect.error ? (collect.error as Error).message : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          Machine facts only — disk, ports, process names, our setup log, package state. Never file
          contents, secret values, or agent transcripts. The owner sees that you collected this.
        </span>
        <Button variant="outline" size="sm" disabled={!running || busy} onClick={() => collect.mutate()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Stethoscope className="size-3.5" />}
          Collect
        </Button>
      </div>

      {error && <p className="text-[12.5px] text-destructive">{error}</p>}

      {report?.sections.map((s) => (
        <details key={s.name} className="rounded-lg border border-border/60">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-medium">{s.name}</summary>
          <pre className="max-h-72 overflow-auto border-t border-border/60 px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-all">
            {s.text || "(empty)"}
          </pre>
        </details>
      ))}
    </div>
  );
}
