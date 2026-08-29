"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmOptions {
  title: string;
  /** Body text/JSX under the title. */
  message?: ReactNode;
  /** Amber caution block, rendered as its own `role="note"` OUTSIDE the description (which is a
   * `<p>`, so it can't legally nest one). The canonical session-interrupt copy lives in
   * `lib/pod-copy.ts`. */
  warning?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). `danger` is an accepted alias (the cockpit's
   * older `setConfirm` used that name) so both spellings work while callsites converge. */
  destructive?: boolean;
  danger?: boolean;
}

type State = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * The app's confirm dialog as a hook — NEVER `window.confirm` (all dashboard modals are UI
 * components). Returns an imperative `confirm(opts): Promise<boolean>` to `await` in a handler, plus
 * a `dialog` element to render once in the component. Resolving `false` on cancel/escape/backdrop.
 *
 *   const { confirm, dialog } = useConfirm();
 *   // in JSX: {dialog}
 *   if (!(await confirm({ title: "Delete X?", destructive: true }))) return;
 */
export function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [state, setState] = useState<State | null>(null);

  // Resolve the CURRENT promise (a Promise resolves once, so a stray onOpenChange after the action
  // click is a harmless no-op) and close.
  const settle = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const confirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }));

  const dialog = (
    <AlertDialog open={!!state} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title}</AlertDialogTitle>
          {state?.message != null && <AlertDialogDescription>{state.message}</AlertDialogDescription>}
        </AlertDialogHeader>
        {state?.warning != null && (
          <p
            role="note"
            className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-[12.5px] text-warning"
          >
            {state.warning}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{state?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={
              state?.destructive || state?.danger
                ? "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                : undefined
            }
          >
            {state?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
