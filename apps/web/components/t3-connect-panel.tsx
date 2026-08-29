"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { disableT3Code, enableT3Code } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { T3OpenSession } from "@/components/t3-open-session";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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


/** The consequence bullets shown in both confirm modals. The first (amber) is the session-interrupt. */
function ConsequenceList({ items }: { items: { warn?: boolean; text: string }[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-2 text-[13px]">
      {items.map((it, i) => (
        <li key={i} className={`flex gap-2 ${it.warn ? "text-warning" : "text-muted-foreground"}`}>
          <span
            aria-hidden
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${it.warn ? "bg-warning ring-2 ring-warning/20" : "bg-muted-foreground/60"}`}
          />
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * T3 Code control — a Settings ROW that hands the pod's agents to the T3 Code app. Enabling confirms
 * first (the hand-off is consequential) and then runs as a full-page wizard (the parent shows
 * <T3Enabling> while provisioning). While T3 is in control it shows the T3-account connect state — a
 * "Connect to your T3 account" trigger (opens the connect wizard) or a "Connected" note — plus a
 * "Turn off" row. `inControl` = T3 owns the agents (durable `t3Control`); `connected` = signed into the
 * owner's T3 account + this env linked, so it syncs to their devices (durable `t3Connected`).
 */
export default function T3ConnectPanel({
  slug,
  podName,
  inControl,
  connected,
  onEnableStarted,
  onDisableStarted,
  onEnable,
  onConnect,
}: {
  slug: string;
  podName: string | null;
  inControl: boolean;
  /** The pod's t3 is signed into the owner's T3 account + this env linked (syncs to their devices). */
  connected: boolean;
  onEnableStarted?: () => void;
  onDisableStarted?: () => void;
  /** When set, the confirm delegates the ENABLE decision to the cockpit (t3-unattended 2.2: a pod that
   * isn't yet on the 1-year token needs the setup-token OAuth first). When absent, T3ConnectPanel enables
   * directly (the legacy subscription-based path). */
  onEnable?: () => void;
  /** Open the T3 Connect wizard (sign into the T3 account + link this env for cross-device sync). */
  onConnect: () => void;
}) {
  const [confirm, setConfirm] = useState<null | "enable" | "disable">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doEnable() {
    setBusy(true);
    setError(null);
    const r = await enableT3Code(slug);
    setBusy(false);
    setConfirm(null);
    if (r && "error" in r) setError(r.error);
    else onEnableStarted?.();
  }

  async function doDisable() {
    setBusy(true);
    setError(null);
    const r = await disableT3Code(slug);
    setBusy(false);
    setConfirm(null);
    if (r && "error" in r) setError(r.error);
    else onDisableStarted?.();
  }

  return (
    <div className="border-t border-border/60 py-3.5 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            T3 Code control
            {inControl && (
              <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10.5px] font-medium text-success">
                On
              </span>
            )}
          </div>
          <p className="mt-0.5 max-w-prose text-[12.5px] text-muted-foreground">
            {inControl ? (
              "In control — Claude and Codex are driven from the T3 app. Turning it off returns control to Podbay and restores its controls."
            ) : (
              <>
                Drive this pod&rsquo;s agents from the{" "}
                <a
                  href="https://t3.codes/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  T3 Code app
                </a>{" "}
                (iOS · Android · desktop).
              </>
            )}
          </p>
        </div>
        {inControl ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className="shrink-0 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
            onClick={() => setConfirm("disable")}
          >
            Turn off T3 control
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className="shrink-0 border-enable/50 bg-enable/[0.06] text-enable hover:bg-enable/10 hover:text-enable"
            onClick={() => setConfirm("enable")}
          >
            Enable T3 Code…
          </Button>
        )}
      </div>

      {inControl && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          {connected ? (
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 text-[13px]">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success ring-2 ring-success/20" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">Connected to your T3 account.</strong> This pod is in
                  the T3 app on your devices — open it there to use it.
                </span>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    aria-label="How to open this pod in T3"
                    title="How to open this pod in T3"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Open this pod in T3</DialogTitle>
                    <DialogDescription>
                      It&rsquo;s connected to your T3 account — here&rsquo;s how to open it in the T3 app.
                    </DialogDescription>
                  </DialogHeader>
                  <T3OpenSession podName={podName?.trim() || slug} />
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="self-start border-enable/50 bg-enable/[0.06] text-enable hover:bg-enable/10 hover:text-enable"
                onClick={onConnect}
              >
                Connect to your T3 account…
              </Button>
              <p className="text-[12.5px] text-muted-foreground">
                Sign in to T3 once so this pod appears in the T3 app on{" "}
                <strong className="text-foreground">every device</strong>, synced. Without it, T3 runs
                only on this pod.
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

      {/* Enable confirm */}
      <AlertDialog open={confirm === "enable"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch this pod to T3 Code?</AlertDialogTitle>
            <AlertDialogDescription>
              T3 Code will control all agents on this pod. Here&apos;s what to expect:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ConsequenceList
            items={[
              { text: "You will continue work only via T3 Code." },
              { warn: true, text: "The current conversations do not transfer." },
              { text: "Your files and agent sign-ins stay unchanged." },
            ]}
          />
          <p className="text-[13px] text-muted-foreground">
            You can turn off T3 anytime to return control to Podbay.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (onEnable) {
                  setConfirm(null);
                  onEnable(); // cockpit decides: setup-token OAuth first, or enable directly
                  return;
                }
                void doEnable();
              }}
            >
              Enable T3 Code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disable confirm */}
      <AlertDialog open={confirm === "disable"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off T3 Code control?</AlertDialogTitle>
            <AlertDialogDescription>
              Control of Claude and Codex returns to Podbay. T3 Code can no longer drive this pod until
              you enable it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ConsequenceList
            items={[
              { warn: true, text: "Podbay starts fresh Claude and Codex sessions again. T3's own conversation doesn't carry back, but every file it changed is right here in your working tree — the resumed agent is pointed at it." },
              { text: "Your files and sign-ins are preserved. Nothing is logged out — the agents stay signed in." },
              { text: "Podbay's Open in Claude and Codex pairing controls come back." },
            ]}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="border-warning/40 bg-transparent text-warning hover:bg-warning/10 hover:text-warning"
              onClick={(e) => {
                e.preventDefault();
                void doDisable();
              }}
            >
              Turn off T3
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
