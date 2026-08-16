"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyCodeButton } from "@/components/copy-code-button";
import { CodexPairPanel } from "@/components/codex-pair-panel";
import {
  addPodAgent,
  getAgentStates,
  getCodexRcActive,
  getCodexDevices,
  setCodexRc,
  forgetCodexDevice,
  sendAgentSigninCode,
} from "@/lib/actions";

const LABELS: Record<string, string> = { "claude-code": "Claude", codex: "Codex" };
const label = (a: string) => LABELS[a] ?? a;

import {
  agentCardState,
  shouldAutoOpenPairing,
  type CardState,
  type LiveAgent,
} from "@/lib/agent-card-state";


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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-56 font-mono text-[13px]"
          value={code}
          onChange={(e) => onCode(e.target.value)}
          placeholder="Paste the code here"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        <Button size="sm" variant="outline" onClick={onSubmit} disabled={!code.trim()}>
          {sent ? "Sent ✓" : "Submit code"}
        </Button>
      </div>
    </div>
  );
}

export default function AgentCards({
  slug,
  podName,
  status,
  primaryAgent,
  agentsOnPod,
  sessionUrl,
  authedAt,
  updateAvailable = false,
  onConfirm,
}: {
  slug: string;
  podName: string | null;
  status: string;
  primaryAgent: string;
  agentsOnPod: string[];
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
}) {
  const running = status === "running";
  /** null = first poll hasn't answered; [] = answered but no per-agent data. */
  const [live, setLive] = useState<LiveAgent[] | null>(null);
  const [legacyCodexRc, setLegacyCodexRc] = useState(false);
  /** null until the first devices fetch answers. The auto-open check MUST wait for
   * this: treating "not loaded yet" as "no devices paired" popped the pairing
   * wizard open on every visit even with a device already paired (2026-07-29). */
  const [devices, setDevices] = useState<{ name: string; at: string }[] | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const [toggling, setToggling] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** First time each agent was seen MISSING from a non-empty live report. A young
   * gap is "starting" (spawn/boot in progress); a persistent one is "not running"
   * — a lost window (e.g. updated before spec.agents was kept current) that the
   * Start action repairs. */
  const missingSinceRef = useRef<Record<string, number>>({});

  const hasCodex = agentsOnPod.includes("codex");

  const refreshDevices = useCallback(async () => {
    setDevices(await getCodexDevices(slug).catch(() => []));
  }, [slug]);
  const deviceList = devices ?? [];

  // ONE poll drives every card. The legacy codexRcActive probe runs only when the
  // pod gave us no per-agent data (old image) — never two sources of truth at once.
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const poll = async () => {
      const states = await getAgentStates(slug);
      if (stop) return;
      setLive(states);
      if (states.length === 0 && hasCodex) {
        const a = await getCodexRcActive(slug).catch(() => false);
        if (!stop) setLegacyCodexRc(a);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [running, slug, hasCodex]);

  useEffect(() => {
    if (hasCodex) void refreshDevices();
  }, [hasCodex, refreshDevices]);

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

  // The ONE moment the pairing wizard opens unasked (see shouldAutoOpenPairing).
  useEffect(() => {
    if (
      shouldAutoOpenPairing({
        alreadyAutoOpened: autoOpenedRef.current,
        hasCodex,
        devices,
        live,
        codexState: stateFor("codex"),
      })
    ) {
      autoOpenedRef.current = true;
      setPairOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, devices, hasCodex]);

  const toggleCodexRc = (on: boolean) => {
    setToggling(true);
    setError(null);
    void setCodexRc(slug, on)
      .then(async (r) => {
        if (r?.error) {
          setError(`Couldn't switch remote control: ${r.error}`);
          return;
        }
        // Ask the POD what happened instead of assuming it worked. The optimistic
        // update was a lie whenever the daemon couldn't actually start (e.g. its
        // runtime was never seeded): the card flipped to "on", opened the pairing
        // wizard, then snapped back on the next poll — which looked like the button
        // did nothing (owner report, 2026-07-29).
        const states = await getAgentStates(slug).catch(() => []);
        if (states.length > 0) setLive(states);
        if (on && !states.find((x) => x.id === "codex")?.rcActive) {
          setError(
            "Remote control didn't come up. If this pod is older, updating it (Settings → Update) installs what Codex needs.",
          );
        }
      })
      .finally(() => setToggling(false));
  };

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
      }
    });
  };

  const card = (id: string) => {
    const st = !running ? "unknown" : stateFor(id);
    const name = label(id);
    return (
      <div
        key={id}
        className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-white/[0.015] px-4 py-3.5"
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Dot
            tone={
              st === "starting"
                ? "spin"
                : st === "needs-signin"
                  ? "warn"
                  : st === "codex-off" || st === "not-running"
                    ? "bad"
                    : st === "unknown"
                      ? "mute"
                      : "ok"
            }
          />
          <span className="text-sm font-semibold">{name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            {st === "starting" && <>starting in a new terminal tab…</>}
            {st === "not-running" && (
              <>
                <strong className="font-medium text-foreground">not running</strong> on this pod —
                its terminal window is gone
              </>
            )}
            {st === "not-running" && (
          <div>
            <Button size="sm" variant="outline" disabled={starting !== null} onClick={() => startAgent(id)}>
              {starting === id ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Starting…
                </>
              ) : (
                <>Start {name}</>
              )}
            </Button>
          </div>
        )}

        {st === "needs-signin" && (
              <>
                running, <strong className="font-medium text-foreground">not signed in yet</strong>
              </>
            )}
            {st === "claude-ready" && <>signed in</>}
            {st === "claude-linked" && <>remote control on</>}
            {st === "codex-on" && (
              <>
                remote control on{deviceList.length > 0 ? <> — paired:</> : <> — no devices paired yet</>}
                {deviceList.map((d) => (
                  <span
                    key={d.name}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[12.5px] text-foreground"
                  >
                    {d.name}
                    {/* This ✕ can only edit OUR note of what you paired. Codex exposes
                        no revoke — its CLI has start|stop|pair and nothing else, and the
                        pairing itself lives in the user's OpenAI account. So it asks
                        first and says exactly that, instead of looking like a disconnect
                        (challenged by the owner, 2026-07-29). */}
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
                              This only changes what Podbay remembers about the devices you&rsquo;ve
                              paired — <strong>{d.name} stays connected</strong>. Codex pairings live
                              in your OpenAI account, not on this pod, so to actually disconnect it,
                              remove this pod in the Codex app.
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
              </>
            )}
            {st === "codex-off" && (
              <>
                remote control <strong className="font-medium text-foreground">off</strong> — paired
                devices can&rsquo;t reach this pod
              </>
            )}
            {st === "unknown" &&
              (running ? (
                <>state unavailable — update this pod&rsquo;s software (Settings) for live agent status</>
              ) : (
                <>pod isn&rsquo;t running</>
              ))}
          </span>
        </div>

        {st === "not-running" && (
          <div>
            <Button size="sm" variant="outline" disabled={starting !== null} onClick={() => startAgent(id)}>
              {starting === id ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Starting…
                </>
              ) : (
                <>Start {name}</>
              )}
            </Button>
          </div>
        )}

        {st === "needs-signin" && (
          <SignIn
            agent={id}
            name={name}
            authValue={live?.find((s) => s.id === id)?.authUrl}
            code={codes[id] ?? ""}
            onCode={(v) => setCodes((c) => ({ ...c, [id]: v }))}
            onSubmit={() => submitCode(id)}
            sent={sentFor === id}
          />
        )}

                {st === "claude-ready" && (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            Enabling remote control…
          </p>
        )}

        {st === "claude-linked" && (live?.find((s) => s.id === id)?.sessionUrl || sessionUrl) && (
          <div data-tour="continue-in-claude" className="w-fit">
            <Button asChild size="sm">
              <a
                href={live?.find((s) => s.id === id)?.sessionUrl || sessionUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue in Claude <ArrowUpRight />
              </a>
            </Button>
          </div>
        )}

        {/* One control. A paired card is DONE: status line + the only action that
            could still be wanted. No disclosure-to-reveal-a-button theatre. */}
        {st === "codex-on" && !pairOpen && (
          <div>
            <Button variant="outline" size="sm" onClick={() => setPairOpen(true)}>
              {deviceList.length > 0 ? "Pair another device" : "Pair a device"}
            </Button>
          </div>
        )}

        {/* There is deliberately no "turn OFF" control: switching remote control off
            only breaks the owner's own devices, and forgetting a device (the chips
            above) is the actual remedy. ON exists purely as recovery from a stopped
            daemon. */}
        {st === "codex-off" &&
          (updateAvailable ? (
            // A pre-multi-agent image can't run Codex remote control (no seeded standalone build), so
            // its toggle would fail. Point the owner at Update instead of a button that does nothing.
            <p className="text-[13px] text-muted-foreground">
              Update this pod (Settings → Update) to use Codex remote control on this image.
            </p>
          ) : (
            <div>
              <Button variant="outline" size="sm" disabled={toggling} onClick={() => toggleCodexRc(true)}>
                {toggling ? <Loader2 className="size-3.5 animate-spin" /> : null} Turn remote control on
              </Button>
            </div>
          ))}

        {id === "codex" && pairOpen && st === "codex-on" && (
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

        {id === "codex" && error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
    );
  };

  return <div className="flex flex-col gap-2.5">{agentsOnPod.map(card)}</div>;
}
