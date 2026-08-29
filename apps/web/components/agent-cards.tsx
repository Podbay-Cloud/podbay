"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Info, Loader2, X } from "lucide-react";
import { AgentLogo } from "@/components/agent-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CopyCodeButton } from "@/components/copy-code-button";
import { CodexPairPanel } from "@/components/codex-pair-panel";
import { CodexContinueSession } from "@/components/codex-continue-session";
import { PasteCodeInput } from "@/components/paste-code-input";
import { SettingRow } from "@/components/setting-row";
import { RowSkeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { SESSION_INTERRUPT_WARNING } from "@/lib/pod-copy";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import {
  addPodAgent,
  reconnectAgent,
  restoreRemoteControl,
  getAgentStates,
  getCodexRcActive,
  getCodexDevices,
  setCodexRc,
  forgetCodexDevice,
  sendAgentSigninCode,
} from "@/lib/actions";

const LABELS: Record<string, string> = { "claude-code": "Claude", codex: "Codex" };
const label = (a: string) => LABELS[a] ?? a;

/** Surface the "reconnect soon" affordance this far ahead of a login's hard expiry — matches the
 * dashboard ribbon window (pod-visual-state.ts) so the card and the ribbon agree. */
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

import { agentCardState, isManagedableState, type CardState, type LiveAgent } from "@/lib/agent-card-state";


function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "spin" | "mute" }) {
  if (tone === "spin") return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />;
  const cls =
    tone === "ok"
      ? "bg-success shadow-[0_0_6px_var(--success)]"
      : tone === "warn"
        ? "bg-warning"
        : tone === "bad"
          ? "bg-destructive"
          : "bg-muted-foreground/50";
  return <span className={`size-2 shrink-0 rounded-full ${cls}`} aria-hidden />;
}

/**
 * The ready-state's per-agent stack (multi-agent redesign, 2026-07-28). One card
 * per agent the pod hosts; nothing about one agent ever renders in the other's
 * card. Truth comes from the pod's per-agent /healthz report, polled while
 * running; legacy pod-level signals are only a fallback for pods whose image
 * predates it. The terminal is deliberately absent here except as a
 * transactional sign-in step — it lives in the Admin tab.
 */
/**
 * An agent's sign-in, in the cockpit — the SAME shape the onboarding wizard uses
 * (open the link / copy the code, paste what it gives back), scoped to one agent.
 * Never a "go to the terminal" hand-off: the terminal is the Admin surface, not a
 * step in the login flow.
 */
function SignIn({
  agent,
  name,
  authValue,
  code,
  onCode,
  onSubmit,
  sent,
}: {
  agent: string;
  name: string;
  /** undefined = this pod's image doesn't report per-agent sign-in values yet;
   * null = reported but not captured yet (spinner); string = ready to show. */
  authValue: string | null | undefined;
  code: string;
  onCode: (v: string) => void;
  onSubmit: () => void;
  sent: boolean;
}) {
  const isCodex = agent === "codex";
  if (authValue === undefined) {
    // Old pod image: it can't hand us this agent's sign-in value. Say so — an
    // eternal spinner here would be a lie.
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Signing {name} in from here needs this pod&rsquo;s software update — Settings → Update, then
        come back to this card.
      </p>
    );
  }
  if (!authValue) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        Getting {name}&rsquo;s sign-in {isCodex ? "code" : "link"}…
      </p>
    );
  }
  // Codex: authValue is the one-time DEVICE CODE (its URL is static). Claude:
  // authValue is the OAuth URL, and the CLI wants the code pasted back.
  if (isCodex) {
    return (
      <div className="flex flex-col gap-2.5 rounded-lg border border-primary/70 bg-primary/10 px-3.5 py-3">
        <span className="text-[13px] text-muted-foreground">
          1. Copy this code &nbsp; 2. Open OpenAI and enter it to authorize:
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          <CopyCodeButton code={authValue} className="px-3 py-2 text-lg tracking-[0.15em]" />
          <Button asChild variant="outline" size="sm">
            <a href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">
              Open OpenAI sign-in <ArrowUpRight />
            </a>
          </Button>
        </div>
        <span className="text-[12.5px] text-muted-foreground">
          This card updates itself once {name} is signed in.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <a
        className="flex flex-col gap-0.5 rounded-lg border border-primary/70 bg-primary/10 px-3.5 py-3 transition-shadow hover:shadow-[0_0_0_3px_rgba(47,107,255,0.18)]"
        href={authValue}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="text-sm font-semibold">Open the {name} sign-in page</span>
        <span className="text-[12.5px] text-[var(--accent-light)]">
          then copy the code it gives you ↗
        </span>
      </a>
      <PasteCodeInput value={code} onChange={onCode} onSubmit={onSubmit} submitted={sent} />
    </div>
  );
}

/** Shown only after RC genuinely fails to come up within the grace window (see toggleCodexRc). Kept as
 * a constant so the auto-clear effect can recognise and drop it the moment live state says RC is up. */
const CODEX_RC_DOWN_MSG =
  "Remote control didn't come up. If this pod is older, updating it (Settings → Update) installs what Codex needs.";

export default function AgentCards({
  slug,
  podName,
  status,
  primaryAgent,
  agentsOnPod,
  addableAgents = [],
  onEnable,
  enabling = null,
  sessionUrl,
  authedAt,
  updateAvailable = false,
  onConfirm,
  externalControl = false,
  onPairCodex,
  onSignin,
}: {
  slug: string;
  podName: string | null;
  status: string;
  primaryAgent: string;
  agentsOnPod: string[];
  /** Supported agents NOT yet on the pod — rendered as their own row with an "Enable" button so the
   * pod always shows Claude AND Codex, on or off (velsa, 2026-08-23). */
  addableAgents?: string[];
  onEnable?: (id: string) => void;
  /** The agent id currently being enabled (spinner on its button); null when idle. */
  enabling?: string | null;
  sessionUrl: string | null;
  authedAt: string | null;
  /** The pod has a newer image available — a pre-multi-agent image can't run Codex remote control
   * (no seeded standalone build), so on an updatable pod we point at Update instead of a dead toggle. */
  updateAvailable?: boolean;
  /** Opens the cockpit's confirm dialog (shared, so there's one dialog on the page). */
  onConfirm: (c: {
    title: string;
    message?: React.ReactNode;
    confirmLabel: string;
    run: () => void;
  }) => void;
  /** An external harness (T3 Code) owns the agents' remote-control right now, so Podbay's own
   * connect surfaces (Open in Claude, Codex pairing) are inert — hide them to avoid dead controls. */
  externalControl?: boolean;
  /** Open the full-page Codex pairing wizard (cockpit takeover). Falls back to the inline panel if
   * not provided (e.g. a harness rendering AgentCards standalone). */
  onPairCodex?: () => void;
  /** Open the full-page Claude sign-in / reconnect wizard (cockpit takeover) for that agent. */
  onSignin?: (agentId: string, mode: "signin" | "reconnect") => void;
}) {
  const running = status === "running";
  const queryClient = useQueryClient();
  const [pairOpen, setPairOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  // The agent currently running a Restore-remote-control attempt — mirrors `reconnecting` so only one
  // attempt can be in flight per agent at a time (rc-reconnect-hardening §4.2: "prevent concurrent
  // attempts").
  const [restoringFor, setRestoringFor] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [sentFor, setSentFor] = useState<string | null>(null);
  // The agent whose sign-in code was just submitted — drives the "Signing in…" progress that REPLACES
  // the paste box until the card advances (authed → claude-ready/linked), so the reconnect flow reads
  // as progress instead of a frozen box that teleports to "Open in Claude" (velsa, 2026-08-23).
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  /** First time each agent was seen MISSING from a non-empty live report. A young
   * gap is "starting" (spawn/boot in progress); a persistent one is "not running"
   * — a lost window (e.g. updated before spec.agents was kept current) that the
   * Start action repairs. */
  const missingSinceRef = useRef<Record<string, number>>({});

  const hasCodex = agentsOnPod.includes("codex");

  // The ONE live-state query (react-query): cached (re-opening Control is instant), polled, bounded
  // retry, and `keepPreviousData` so a transient healthz blip never blanks the cards or reads
  // "Status unavailable". Fast cadence while a sign-in is in flight. Paused when the tab is hidden.
  const { data: liveData, isLoading: liveLoading } = useQuery({
    queryKey: qk.agents(slug),
    queryFn: () => getAgentStates(slug),
    enabled: running,
    refetchInterval: running ? (submittingFor ? 2_000 : 10_000) : false,
    placeholderData: keepPreviousData,
  });
  const live: LiveAgent[] | null = liveData ?? null;

  // Legacy codex-RC probe — only when the pod genuinely gave no per-agent data (an old image), i.e.
  // `live` settled to []. Never two sources of truth at once.
  const { data: legacyCodexRc = false } = useQuery({
    queryKey: qk.codexRc(slug),
    queryFn: () => getCodexRcActive(slug),
    enabled: running && hasCodex && live?.length === 0,
  });

  // Paired Codex devices. `null` until the first fetch answers — the auto-open check MUST wait for it
  // (treating not-loaded as "no devices" popped the wizard on every visit, 2026-07-29).
  const { data: devicesData, refetch: refetchDevices } = useQuery({
    queryKey: qk.codexDevices(slug),
    queryFn: () => getCodexDevices(slug),
    enabled: running && hasCodex,
  });
  const devices = devicesData ?? null;
  const deviceList = devices ?? [];
  const refreshDevices = () => void refetchDevices();

  // Clear "Signing in…" once the agent actually advances (authed → the card moves to
  // claude-ready/linked, which show their own progress) — or after a safety timeout so a login that
  // never completes falls back to the paste box instead of spinning forever.
  useEffect(() => {
    if (!submittingFor) return;
    const a = live?.find((s) => s.id === submittingFor);
    if (a && (a.authed || a.loginExpired || a.needsReauth)) {
      setSubmittingFor(null);
      return;
    }
    const t = window.setTimeout(() => setSubmittingFor(null), 90_000);
    return () => window.clearTimeout(t);
  }, [live, submittingFor]);

  const stateFor = (id: string): CardState => {
    const l = live?.find((s) => s.id === id);
    if (l) delete missingSinceRef.current[id];
    else if (live !== null && live.length > 0) missingSinceRef.current[id] ??= Date.now();
    return agentCardState({
      id,
      live,
      primaryAgent,
      sessionUrl,
      authedAt,
      legacyCodexRc,
      running,
      missingSince: missingSinceRef.current[id],
      startingNow: starting === id,
      now: Date.now(),
    });
  };

  // Pairing never opens itself: an empty/loading remembered-device list means "Podbay
  // remembers no labels," not "nothing is paired" (OpenAI-side enrollment is invisible to
  // Podbay) and not "onboarding is incomplete." The full-page wizard opens ONLY from the
  // explicit "Pair a device" button below (design: rc-reconnect-hardening §6).

  const toggleCodexRc = (on: boolean) => {
    setToggling(true);
    setError(null);
    void setCodexRc(slug, on)
      .then(async (r) => {
        if (r?.error) {
          setError(`Couldn't switch remote control: ${r.error}`);
          return;
        }
        // Ask the POD what happened instead of assuming it worked — but RC (the codex daemon) takes a
        // few seconds to come up, so a single immediate check false-negatives and stuck a "didn't come
        // up" error on every turn-on even when it succeeded a beat later (velsa, podbay first10). POLL
        // for rcActive across a grace window; only surface the error if it's STILL down at the end.
        if (on) {
          const deadline = Date.now() + 20_000;
          let active = false;
          for (;;) {
            const states = await getAgentStates(slug).catch(() => []);
            if (states.find((x) => x.id === "codex")?.rcActive) {
              active = true;
              break;
            }
            if (Date.now() >= deadline) break;
            await new Promise((res) => setTimeout(res, 2_000));
          }
          void queryClient.invalidateQueries({ queryKey: qk.agents(slug) }); // refresh the displayed state
          if (!active) setError(CODEX_RC_DOWN_MSG);
        } else {
          void queryClient.invalidateQueries({ queryKey: qk.agents(slug) });
        }
      })
      .finally(() => setToggling(false));
  };

  // Safety net for the RC-down banner: the moment LIVE state says codex RC is active, drop the
  // "didn't come up" error if it's showing. Covers the residual race where RC comes up just after the
  // toggle's grace window closes — live truth wins, so the green "connected" card never coexists with
  // the red failure banner again.
  useEffect(() => {
    if (live?.find((s) => s.id === "codex")?.rcActive) {
      setError((e) => (e === CODEX_RC_DOWN_MSG ? null : e));
    }
  }, [live]);

  const startAgent = (id: string) => {
    setStarting(id);
    setError(null);
    void addPodAgent(slug, id) // idempotent + healing: respawns the lost window
      .then((r) => {
        if (r?.error) setError(`Couldn't start ${label(id)}: ${r.error}`);
        else missingSinceRef.current[id] = Date.now(); // restart the "starting" grace
      })
      .finally(() => setStarting(null));
  };

  const doReconnect = (id: string) => {
    setReconnecting(id);
    setError(null);
    // Wipe the dead token + respawn into /login; the sign-in link then appears here on the next poll.
    void reconnectAgent(slug, id)
      .then((r) => {
        if (r?.error) setError(`Couldn't reconnect ${label(id)}: ${r.error}`);
      })
      .finally(() => setReconnecting(null));
  };

  /** rc-reconnect-hardening §4.2: the explicit Restore-remote-control action for `claude-down`. Calls
   * the same bounded primitive doctor uses and renders what it OBSERVED — never assumes success just
   * because the request completed — then refetches the shared health query so the card re-derives its
   * state from the reclassified result instead of a locally-guessed one. */
  const doRestoreRc = (id: string) => {
    setRestoringFor(id);
    setError(null);
    void restoreRemoteControl(slug, id)
      .then((r) => {
        if ("error" in r) {
          setError(`Couldn't restore remote control: ${r.error}`);
        } else if (!r.ok) {
          setError(
            r.reason === "login-required"
              ? `${label(id)}'s login needs to be reconnected before remote control can be restored.`
              : "Remote control didn't come back up. Try again in a moment.",
          );
        }
        void queryClient.invalidateQueries({ queryKey: qk.agents(slug) }); // re-render from the OBSERVED state
      })
      .finally(() => setRestoringFor(null));
  };

  /** ms until this agent's login hard-expires, or null if it's not authed / not near expiry. Drives
   * the OPTIONAL "reconnect soon" affordance while the login still works (distinct from login-expired,
   * which is already dead and blocks the agent). */
  const expiringInMs = (id: string): number | null => {
    const l = live?.find((s) => s.id === id);
    if (!l || !l.authed || l.loginExpired || l.needsReauth || l.expiresAt == null) return null;
    const left = l.expiresAt - Date.now();
    return left > 0 && left < EXPIRING_SOON_MS ? left : null;
  };

  /** Reconnect a login that is expiring but STILL VALID — optional, so it's confirmed first (it's a full
   * re-login that interrupts the session; there's no way to extend a refresh token past its hard expiry).
   * Claude routes through the full-page wizard; codex wipes + respawns in place. */
  const reconnectExpiring = async (id: string) => {
    const left = expiringInMs(id);
    const days = left != null ? Math.max(1, Math.round(left / (24 * 60 * 60 * 1000))) : null;
    const ok = await confirm({
      title: `Reconnect ${label(id)} now?`,
      message: `${label(id)}'s login still works${days != null ? ` for ~${days} more day${days === 1 ? "" : "s"}` : ""}. Reconnecting signs it out and starts a fresh sign-in now — do this when it's convenient, before the login expires.`,
      warning: SESSION_INTERRUPT_WARNING,
      confirmLabel: `Reconnect ${label(id)}`,
    });
    if (!ok) return;
    if (id === "claude-code" && onSignin) onSignin(id, "reconnect");
    else doReconnect(id);
  };

  /** Send the pasted sign-in code to THAT agent's window, server-side. The old
   * path typed it over the terminal WebSocket, which follows the active window —
   * wrong the moment a pod runs two agents. */
  const submitCode = (id: string) => {
    const code = (codes[id] ?? "").trim();
    if (!code) return;
    setError(null);
    void sendAgentSigninCode(slug, id, code).then((r) => {
      if (r?.error) setError(`Couldn't send the code: ${r.error}`);
      else {
        setCodes((c) => ({ ...c, [id]: "" }));
        setSentFor(id);
        window.setTimeout(() => setSentFor(null), 4000);
        // Show "Signing in…" until the card actually advances (cleared by the effect below on authed,
        // or a safety timeout). Login can take ~10-30s; the poll also accelerates meanwhile.
        setSubmittingFor(id);
      }
    });
  };

  const card = (id: string) => {
    const st = !running ? "unknown" : stateFor(id);
    const name = label(id);
    // T3 owns the agents' sessions while it's in control — the agent's own controls are inert, so
    // the row dims to a "Managed by T3" state (only for an otherwise-healthy agent; a not-signed-in
    // or expired agent still needs attention regardless). isManagedableState is the SAME predicate a
    // unit test can pin down (see its own doc comment for why this moved out of an inline array).
    const managed = externalControl && isManagedableState(st);
    const dotTone = managed
      ? "mute"
      : st === "starting" || st === "claude-recovering"
        ? "spin"
        : st === "needs-signin" || st === "login-expired"
          ? "warn"
          : st === "codex-off" || st === "not-running" || st === "claude-down"
            ? "bad"
            : st === "unknown" || st === "claude-rc-unknown"
              ? "mute"
              : "ok";

    // One honest description line per state (mirrors the Settings rows).
    const desc: React.ReactNode = managed ? (
      <>T3 Code is driving this session — Podbay&rsquo;s controls are paused while T3 is on.</>
    ) : st === "starting" ? (
      <>Starting in a new terminal tab…</>
    ) : st === "not-running" ? (
      <>Not running — its terminal window is gone; Podbay is restarting it.</>
    ) : st === "needs-signin" ? (
      <>Not signed in yet — open the link and paste the code below.</>
    ) : st === "login-expired" ? (
      <><span className="text-warning">Sign-in expired</span> — reconnect to keep {name} working.</>
    ) : st === "claude-ready" ? (
      <>Signed in — turning on remote control…</>
    ) : st === "claude-down" ? (
      <><span className="text-destructive">Remote control is down</span> — restore it to reopen the live session.</>
    ) : st === "claude-recovering" ? (
      <>Restoring remote control…</>
    ) : st === "claude-rc-unknown" ? (
      <>Remote control status couldn&rsquo;t be verified right now — not a failure, but not confirmed on either.</>
    ) : st === "claude-linked" ? (
      <>Remote control is on — open the live session in the Claude app or browser.</>
    ) : st === "codex-on" ? (
      <>Remote control is on — paired devices can reach this pod.</>
    ) : st === "codex-off" ? (
      updateAvailable ? (
        <>Codex remote control needs a newer image — update this pod (Settings → Update).</>
      ) : (
        <>Remote control is turned off — devices can&rsquo;t reach this pod until you turn it on.</>
      )
    ) : running ? (
      <>Status unavailable — update this pod&rsquo;s software (Settings) for live status.</>
    ) : (
      <>Pod isn&rsquo;t running.</>
    );

    const rightAction = managed ? null : st === "not-running" ? (
      <Button size="sm" variant="outline" disabled={starting !== null} onClick={() => startAgent(id)}>
        {starting === id ? (<><Loader2 className="size-3.5 animate-spin" /> Starting…</>) : (<>Start {name}</>)}
      </Button>
    ) : st === "login-expired" ? (
      <Button
        size="sm"
        variant="outline"
        disabled={reconnecting !== null}
        onClick={() => (id === "claude-code" && onSignin ? onSignin(id, "reconnect") : doReconnect(id))}
      >
        {reconnecting === id ? (<><Loader2 className="size-3.5 animate-spin" /> Reconnecting…</>) : (<>Reconnect {name}</>)}
      </Button>
    ) : st === "claude-down" ? (
      <Button size="sm" variant="outline" disabled={restoringFor !== null} onClick={() => doRestoreRc(id)}>
        {restoringFor === id ? (<><Loader2 className="size-3.5 animate-spin" /> Restoring…</>) : (<>Restore remote control</>)}
      </Button>
    ) : st === "claude-linked" && (live?.find((s) => s.id === id)?.sessionUrl || sessionUrl) ? (
      <div data-tour="continue-in-claude">
        <Button asChild size="sm">
          <a
            href={live?.find((s) => s.id === id)?.sessionUrl || sessionUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
          >
            <AgentLogo agent="claude-code" className="size-[15px] rounded-[4px]" />
            Open in Claude <ArrowUpRight />
          </a>
        </Button>
      </div>
    ) : st === "codex-on" && !pairOpen ? (
      <div className="flex items-center gap-1.5">
        {/* The (i) uses the app's standard Info-in-a-Dialog pattern (see UpdateBasicsDialog), sitting
            beside the primary action exactly like Settings' ⓘ beside Update. */}
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="How to open the session"
              title="How to open the session"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            >
              <Info className="h-4 w-4" />
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Continue this Codex session</DialogTitle>
              <DialogDescription>
                Use the ChatGPT app on your phone or computer to continue working in this pod.
              </DialogDescription>
            </DialogHeader>
            <CodexContinueSession podName={podName?.trim() || slug} />
          </DialogContent>
        </Dialog>
        <Button variant="outline" size="sm" onClick={onPairCodex ?? (() => setPairOpen(true))}>
          {deviceList.length > 0 ? "Pair another device" : "Pair a device"}
        </Button>
      </div>
    ) : st === "codex-off" && !updateAvailable ? (
      <Button variant="outline" size="sm" disabled={toggling} onClick={() => toggleCodexRc(true)}>
        {toggling ? <Loader2 className="size-3.5 animate-spin" /> : null} Turn on
      </Button>
    ) : null;

    return (
      <div key={id} className={`border-t border-border/60 py-3.5 first:border-t-0 ${managed ? "opacity-55" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Dot tone={dotTone} />
              {name}
              {managed && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11.5px] font-normal text-muted-foreground">Managed by T3</span>}
              {!managed && st === "codex-on" && deviceList.map((d) => (
                <span key={d.name} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-normal text-foreground">
                  {d.name}
                  {/* ✕ edits only OUR note (Codex exposes no revoke; pairing lives in the user's OpenAI
                      account) — so it asks first and says exactly that (2026-07-29). */}
                  <button
                    type="button"
                    aria-label={`Remove ${d.name} from this list`}
                    title="Remove from this list"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      onConfirm({
                        title: `Remove ${d.name} from this list?`,
                        message: (
                          <>
                            This only changes what Podbay remembers about the devices you&rsquo;ve paired —{" "}
                            <strong>{d.name} stays connected</strong>. Codex pairings live in your OpenAI
                            account, not on this pod, so to actually disconnect it, remove this pod in the
                            ChatGPT app.
                          </>
                        ),
                        confirmLabel: "Remove from list",
                        run: () => void forgetCodexDevice(slug, d.name).then(refreshDevices),
                      })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">{desc}</div>
          </div>
          {rightAction && <div className="shrink-0">{rightAction}</div>}
        </div>

        {/* Rich states + the (i) popover live full-width below the header. */}
        <div className="mt-2.5 flex flex-col gap-2.5 empty:mt-0 empty:hidden">
          {!managed && st === "needs-signin" &&
            (submittingFor === id ? (
              <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                Signing in… <span className="text-muted-foreground/70">this can take a moment</span>
              </p>
            ) : id === "claude-code" && onSignin ? (
              // Claude sign-in is a full-page wizard (cockpit takeover); the card just launches it.
              <Button variant="outline" size="sm" className="self-start" onClick={() => onSignin(id, "signin")}>
                Sign in to {name}…
              </Button>
            ) : (
              <SignIn
                agent={id}
                name={name}
                authValue={live?.find((s) => s.id === id)?.authUrl}
                code={codes[id] ?? ""}
                onCode={(v) => setCodes((c) => ({ ...c, [id]: v }))}
                onSubmit={() => submitCode(id)}
                sent={sentFor === id}
              />
            ))}
          {!managed && id === "codex" && pairOpen && st === "codex-on" && (
            <CodexPairPanel
              slug={slug}
              podName={podName}
              embedded
              onClose={() => setPairOpen(false)}
              onPaired={() => {
                void refreshDevices();
                setPairOpen(false);
              }}
            />
          )}
          {!managed && expiringInMs(id) != null && (
            // The login still WORKS but hard-expires soon. An optional, confirm-gated reconnect so the
            // dashboard's "reconnect soon in the Control tab" ribbon actually has an action here — the
            // gap an owner hit on a signed-in-but-expiring pod (2026-08-26).
            <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12.5px] text-warning">
                {name}&rsquo;s login expires in ~{Math.max(1, Math.round(expiringInMs(id)! / (24 * 60 * 60 * 1000)))}
                d. Reconnect before then to avoid an interruption.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 self-start border-warning/40 text-warning hover:bg-warning/10 hover:text-warning sm:self-auto"
                disabled={reconnecting !== null}
                onClick={() => void reconnectExpiring(id)}
              >
                {reconnecting === id ? (
                  <><Loader2 className="size-3.5 animate-spin" /> Reconnecting…</>
                ) : (
                  <>Reconnect {name}…</>
                )}
              </Button>
            </div>
          )}
          {id === "codex" && error && <p className="text-[12.5px] text-destructive">{error}</p>}
        </div>
      </div>
    );
  };

  /** A supported agent that isn't on the pod yet — the canonical SettingRow with a bluish "Enable"
   * (opens the same add-agent confirm the old "Add agent" block used, via onEnable). */
  const enableCard = (id: string) => (
    <SettingRow
      key={id}
      label={<span className="flex items-center gap-2"><Dot tone="mute" /> {label(id)}</span>}
      desc={`Not enabled on this pod — enable it to run ${label(id)} here, in its own terminal tab.`}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={enabling !== null}
        className="shrink-0 border-enable/50 bg-enable/[0.06] text-enable hover:bg-enable/10 hover:text-enable"
        onClick={() => onEnable?.(id)}
      >
        {enabling === id ? (<><Loader2 className="size-3.5 animate-spin" /> Enabling…</>) : (<>Enable {label(id)}…</>)}
      </Button>
    </SettingRow>
  );

  // Always show the supported agents in a FIXED order (Claude, then Codex, then any future agents),
  // the SAME on every pod — not whatever order this pod happens to list them in. On the pod → its
  // state; supported but not on the pod → an Enable row. (T3 Code is rendered as the last row by the
  // cockpit, after this.)
  const AGENT_ORDER = ["claude-code", "codex"];
  const supported = (id: string) => agentsOnPod.includes(id) || addableAgents.includes(id);
  const ordered = [
    ...AGENT_ORDER.filter(supported),
    ...[...agentsOnPod, ...addableAgents].filter((id) => !AGENT_ORDER.includes(id)),
  ];
  const allIds = Array.from(new Set(ordered));
  // A genuine cold first load (no cache) shows a skeleton for the on-pod agents instead of flashing
  // "unknown"; re-opening Control hits the cache → no skeleton, instant.
  const agentsLoading = running && liveLoading && live === null;
  return (
    <>
      {allIds.map((id) =>
        agentsOnPod.includes(id)
          ? agentsLoading
            ? <RowSkeleton key={id} />
            : card(id)
          : enableCard(id),
      )}
      {confirmDialog}
    </>
  );
}
