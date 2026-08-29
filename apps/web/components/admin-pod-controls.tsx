"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SESSION_INTERRUPT_WARNING } from "@/lib/pod-copy";
import SizePicker from "@/components/size-picker";
import type { PodSize } from "@podbay/shared/tiers";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminWakePod,
  adminSleepPod,
  adminDestroyPod,
  adminResizePod,
  adminUpdatePod,
  adminRollbackPod,
} from "@/lib/admin-pod-actions";

/**
 * Backoffice per-pod controls, placed CONTEXTUALLY next to the data they act on
 * (Status row → Suspend/Resume, Image row → Update + info/rollback modal, and a
 * Danger zone at the bottom for Destroy). Every layout is flex-wrap so a narrow
 * (mobile) row degrades to the action wrapping under its label rather than
 * overflowing. Replaces the old single top button row.
 */

type Result = { error: string } | void;

const BTN = "h-7 px-2 text-[12px]";
const AMBER_BTN = `${BTN} border-warning/40 text-warning hover:bg-warning/10 hover:text-warning`;
const GREEN_BTN = `${BTN} border-success/40 text-success hover:bg-success/10 hover:text-success`;

// ── Status row: Suspend (amber, confirmed) / Resume (green, direct) ──────────
export function StatusAction({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  const run = (fn: () => Promise<Result>, closeDialog = false) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
      else {
        if (closeDialog) setConfirmSuspend(false);
        router.refresh();
      }
    });
  };

  // Resume: the non-destructive "go" action → run directly, green (leads to running).
  if (status === "suspended") {
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {error && <span className="text-[11px] text-destructive">{error}</span>}
        <Button variant="outline" size="sm" className={GREEN_BTN} disabled={pending} onClick={() => run(() => adminWakePod(id))}>
          {pending ? "…" : "Resume"}
        </Button>
      </span>
    );
  }

  // Suspend: ends the live session → amber (leads to suspended) + confirmation.
  if (status === "running") {
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        <Button variant="outline" size="sm" className={AMBER_BTN} disabled={pending} onClick={() => setConfirmSuspend(true)}>
          Suspend
        </Button>
        <AlertDialog open={confirmSuspend} onOpenChange={(o) => !o && !pending && setConfirmSuspend(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Suspend this pod?</AlertDialogTitle>
              <AlertDialogDescription>
                Pauses the pod to free compute. Files and sign-ins are kept, but the live session
                ends — it stays suspended until Resume, so the agent app and preview disconnect until
                then.
              </AlertDialogDescription>
              {/* The same warning the owner sees. An operator suspending someone
                  else's pod is MORE likely to destroy work in progress than the
                  owner is, not less — they can't see what the agent was doing. */}
              <p className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
                {SESSION_INTERRUPT_WARNING}
              </p>
            </AlertDialogHeader>
            {error && <p className="text-[12.5px] text-destructive">{error}</p>}
            <AlertDialogFooter>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmSuspend(false)}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" disabled={pending} className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning" onClick={() => run(() => adminSleepPod(id), true)}>
                {pending ? "Working…" : "Suspend"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
    );
  }

  return null; // transitional states have no action
}

// ── Image row: Update button + info modal (details + contextual Rollback) ────
type ImageMeta = { digest: string; notes: string | null; builtAt: string | null } | null;

export function ImageActions({
  id,
  stale,
  updating = false,
  current,
  rollbackTo,
}: {
  id: string;
  stale: boolean;
  /** An update is running right now. The chip must not claim "up to date" while a
   * pod is mid-update — that is exactly when an operator is looking at it. */
  updating?: boolean;
  current: ImageMeta;
  rollbackTo: ImageMeta;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runUpdate = () => {
    setErr(null);
    start(async () => {
      const r = await adminUpdatePod(id);
      if (r?.error) setErr(r.error);
      else {
        setConfirmUpdate(false);
        router.refresh();
      }
    });
  };
  const runRollback = () => {
    setErr(null);
    start(async () => {
      const r = await adminRollbackPod(id);
      if (r?.error) setErr(r.error);
      else {
        setInfoOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <span
        className={
          stale
            ? "rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[10.5px] font-semibold text-warning"
            : "rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10.5px] font-semibold text-success"
        }
      >
        {updating ? "updating…" : stale ? "update available" : "up to date"}
      </span>

      {stale && (
        <Button variant="outline" size="sm" className={AMBER_BTN} disabled={pending} onClick={() => setConfirmUpdate(true)}>
          Update
        </Button>
      )}

      <button
        type="button"
        aria-label="Image details"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        onClick={() => setInfoOpen(true)}
      >
        <Info className="h-4 w-4" />
      </button>

      {/* Update confirmation */}
      <AlertDialog open={confirmUpdate} onOpenChange={(o) => !o && !pending && setConfirmUpdate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update this pod?</AlertDialogTitle>
            <AlertDialogDescription>
              Recreates the pod from the current image, keeping its home volume — files, sign-ins and
              the agent&rsquo;s plan survive. The live session ends; each agent resumes its previous
              session on boot.
            </AlertDialogDescription>
            {/* Was "the agent resumes with `claude --continue`" — untrue on a Codex
                pod, and this page is used to update pods the operator didn't set up. */}
            <p className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
              {SESSION_INTERRUPT_WARNING}
            </p>
          </AlertDialogHeader>
          {err && <p className="text-[12.5px] text-destructive">{err}</p>}
          <AlertDialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmUpdate(false)}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" disabled={pending} className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning" onClick={runUpdate}>
              {pending ? "Working…" : "Update & restart"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Info modal: current image details + contextual rollback */}
      <Dialog open={infoOpen} onOpenChange={(o) => !pending && setInfoOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Image</DialogTitle>
            <DialogDescription>What this pod is running, and what it can roll back to.</DialogDescription>
          </DialogHeader>

          <ImageDetail label="Current" meta={current} />

          {rollbackTo && (
            <div className="mt-1 border-t border-border/60 pt-3">
              <ImageDetail label="Previous (rollback target)" meta={rollbackTo} />
              {err && <p className="mt-2 text-[12.5px] text-destructive">{err}</p>}
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                  disabled={pending}
                  onClick={runRollback}
                >
                  {pending ? "Rolling back…" : "Roll back to this image"}
                </Button>
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Recreates the pod from the previous image (keeps the home volume). Use if the last
                  update misbehaves.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}

function ImageDetail({ label, meta }: { label: string; meta: ImageMeta }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {meta ? (
        <>
          <code className="break-all font-mono text-[12px]">{meta.digest.slice(0, 24)}</code>
          <span className="text-[12px] text-muted-foreground">{meta.builtAt ?? "built date unknown"}</span>
          {meta.notes && <p className="mt-0.5 text-[13px]">{meta.notes}</p>}
        </>
      ) : (
        <span className="text-[12px] text-muted-foreground">No manifest record for this digest.</span>
      )}
    </div>
  );
}

// ── Size row: resize (restarts the pod, changes what the owner is billed) ────
export function ResizeAction({ id, size }: { id: string; size: PodSize }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<PodSize>(size);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {error && <span className="text-[11px] text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        className={BTN}
        disabled={pending}
        onClick={() => {
          setTo(size);
          setOpen(true);
        }}
      >
        {pending ? "…" : "Change"}
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resize this pod?</AlertDialogTitle>
            <AlertDialogDescription>
              Applying a new size restarts the pod (a minute or two) — files and sign-ins are kept.
              CPU and RAM change to the tier; disk can only grow.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Said plainly, because the operator is spending someone else's money:
              the size is what the owner is billed on, and they will see this in
              their own activity list either way. */}
          <p className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
            This changes what the owner is billed, and {SESSION_INTERRUPT_WARNING.charAt(0).toLowerCase()}
            {SESSION_INTERRUPT_WARNING.slice(1)}
          </p>
          <SizePicker value={to} onChange={setTo} />
          {error && <p className="text-[12.5px] text-destructive">{error}</p>}
          <AlertDialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || to === size}
              onClick={() => {
                setError(null);
                start(async () => {
                  const r = await adminResizePod(id, to);
                  if (r?.error) setError(r.error);
                  else {
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              {pending ? "Resizing…" : to === size ? "Pick a different size" : `Resize to ${to}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

// ── Danger zone: Delete ────────────────────────────────────────────────────
export function DangerZone({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = () => {
    setErr(null);
    start(async () => {
      const r = await adminDestroyPod(id);
      if (r?.error) setErr(r.error);
      else {
        setOpen(false);
        router.push("/admin/pods");
      }
    });
  };
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <div className="text-sm font-semibold text-destructive">Danger zone</div>
          <p className="text-[12.5px] text-muted-foreground">
            Permanently deletes the pod and its home volume — files, Claude login and data are gone
            for good. This cannot be undone.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          Delete pod
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pod?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently deletes the pod AND its home volume. This cannot be undone — files, Claude
              login and data are gone for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {err && <p className="text-[12.5px] text-destructive">{err}</p>}
          <AlertDialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={run}
            >
              {pending ? "Working…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
