"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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

/**
 * "Disconnect GitHub", always behind a confirmation. Disconnecting drops the
 * stored connection for the account, so anything relying on it (private-repo
 * clones in a running pod) stops working until the user reconnects — not
 * something to trigger on a stray click.
 */
export function DisconnectGithubButton({
  onConfirm,
  variant = "outline",
  login,
}: {
  onConfirm: () => void | Promise<void>;
  variant?: "outline" | "link";
  login?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === "link" ? (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          onClick={() => setOpen(true)}
        >
          Disconnect
        </button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Disconnect
        </Button>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitHub{login ? ` (@${login})` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              Podbay will forget this GitHub connection. Cloning or pulling private repos from
              this pod will stop working until you connect again. Nothing already cloned is
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep connected</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirm(); }} disabled={busy}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
