"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, RotateCcw, Square } from "lucide-react";
import {
  clearLandingHomepageOverride,
  pinLandingExperiment,
  stopLandingExperiment,
} from "@/lib/admin-actions";
import type { LandingVariant } from "@/lib/landing-experiment-config";
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

type Confirmation =
  | { action: "stop" }
  | { action: "pin"; variant: LandingVariant }
  | { action: "clear-homepage" }
  | null;

export default function ExperimentControls({
  experimentId,
  status,
  pinnedVariant,
  variants,
  mutable,
  controlType,
}: {
  experimentId: string;
  status: string;
  pinnedVariant: LandingVariant | null;
  variants: readonly LandingVariant[];
  mutable: boolean;
  controlType: "acquisition" | "homepage-promotion";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Confirmation>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (!confirm) return;
    const choice = confirm;
    setConfirm(null);
    setError(null);
    start(async () => {
      try {
        if (choice.action === "stop") await stopLandingExperiment(experimentId);
        else if (choice.action === "clear-homepage") await clearLandingHomepageOverride();
        else await pinLandingExperiment(experimentId, choice.variant);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Experiment action failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {mutable && controlType === "homepage-promotion" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={pinnedVariant === "selfhost" ? "secondary" : "outline"}
            disabled={pending || pinnedVariant === "selfhost"}
            onClick={() => setConfirm({ action: "pin", variant: "selfhost" })}
          >
            <Pin className="size-3.5" />
            Show on homepage
          </Button>
          <Button
            variant={pinnedVariant === null ? "secondary" : "outline"}
            disabled={pending || pinnedVariant === null}
            onClick={() => setConfirm({ action: "clear-homepage" })}
          >
            <RotateCcw className="size-3.5" />
            Keep only at /selfhost
          </Button>
        </div>
      ) : mutable ? <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending || status === "stopped"}
          onClick={() => setConfirm({ action: "stop" })}
        >
          <Square className="size-3.5" />
          Stop experiment
        </Button>
        {variants.map((variant) => (
          <Button
            key={variant}
            variant={pinnedVariant === variant ? "secondary" : "outline"}
            disabled={pending && pinnedVariant !== variant}
            onClick={() => setConfirm({ action: "pin", variant })}
          >
            <Pin className="size-3.5" />
            Pin {variant}
          </Button>
        ))}
      </div> : (
        <p className="max-w-xs rounded-md border border-border/60 px-3 py-2 text-[12.5px] text-muted-foreground">
          Historical definition. Results remain available, but runtime controls are disabled.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-[12.5px] text-muted-foreground">
        {controlType === "homepage-promotion"
          ? "The page always remains available at /selfhost. Homepage changes are audited."
          : "Allocation, variants, metrics, and content are immutable. Stop and Pin are audited."}
      </p>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "stop"
                ? "Stop this experiment?"
                : confirm?.action === "clear-homepage"
                  ? "Remove self-host from the homepage?"
                : `Pin ${confirm?.action === "pin" ? confirm.variant : ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "stop"
                ? "New enrollment stops immediately. Existing assignments and measurements remain."
                : confirm?.action === "clear-homepage"
                  ? "The current acquisition landing returns at /. The self-host page remains available at /selfhost."
                : controlType === "homepage-promotion"
                  ? "The self-host landing will render at both / and /selfhost. The acquisition experiment and its measurements stay unchanged."
                  : "This stops new enrollment and makes the selected variant the canonical landing experience. Existing measurements remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>
              {confirm?.action === "stop"
                ? "Stop experiment"
                : confirm?.action === "clear-homepage"
                  ? "Keep only at /selfhost"
                  : controlType === "homepage-promotion"
                    ? "Show on homepage"
                    : "Pin variant"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
