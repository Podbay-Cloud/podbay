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
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
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
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{state?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={
              state?.destructive
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
