"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { track } from "@/lib/track";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Pencil, Loader2, ClipboardPaste, TriangleAlert } from "lucide-react";
import {
  wakePod,
  sleepPod,
  destroyPod,
  renamePod,
  setPodPreviewPublic,
  updatePodImage,
  podUpdateProgress,
  resizePod,
  resizePodLive,
  getPodSessionUrl,
  getPodAuthUrl,
  addPodAgent,
  markWalkthroughSeen,
  sendAgentSigninCode,
} from "@/lib/actions";
import SizePicker from "@/components/size-picker";
import HostResourceChooser, { type HostCapacity } from "@/components/host-resource-chooser";
import PodStats from "@/components/pod-stats";
import PodUpdating from "@/components/pod-updating";
import PodSuspended from "@/components/pod-suspended";
import { POD_TIERS, labelForPod, type PodSize } from "@podbay/shared/tiers";
import { TerminalClient } from "@/lib/terminal-client";
import ProvisionStages from "@/components/provision-stages";
import WizardProgress from "@/components/wizard-progress";
import SecretsPanel from "@/components/secrets-panel";
import GithubConnect from "@/components/github-connect";
import Link from "next/link";
import { RelayInfoDialog } from "@/components/relay-info-dialog";
import { RelayStatus } from "@/components/relay-status";
import type { MyRelayLive } from "@/lib/relay-actions";
import ConnectWalkthrough from "@/components/connect-walkthrough";
import { CopyCodeButton } from "@/components/copy-code-button";
import AgentCards from "@/components/agent-cards";
import PreviewCard from "@/components/preview-card";
import HealthStrip from "@/components/health-strip";
import HealthPanel from "@/components/health-panel";
import ActivityTab from "@/components/activity-tab";
import type { ActivityEvent } from "@/lib/pod-activity";
import LifecycleTimeline from "@/components/lifecycle-timeline";
import type { LifecycleInterval } from "@podbay/control-plane";
import { shortDigest } from "@/lib/pod-image";
import { SESSION_INTERRUPT_WARNING } from "@/lib/pod-copy";
import {
  UpdateInfoDialog,
  UpdateBasicsDialog,
  updateHeadline,
  type UpdateInfo,
} from "@/components/update-info-dialog";
import { StatusDot, StatusBadge } from "@/components/pod-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
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
import { type SetupStep, readyWaitMsForAgent } from "@/lib/pod-onboarding";

/**
 * The pod cockpit at /dashboard/pods/<slug>: the durable, DB-reflected home for
 * one pod. Before onboarding finishes it's a guided setup (progress + sign-in);
 * once ready it's the control room — every status and every control. It advances
 * live over the gateway WS and polls the server while anything is in flight.
 */

function isAuthUrl(u: string): boolean {
  return /claude\.(com|ai)\/.*(oauth|login)|anthropic\.com\/.*(oauth|login)/i.test(u);
}
function isSessionUrl(u: string): boolean {
  return /claude\.ai\/code\/session_[A-Za-z0-9]+/.test(u);
}

/** CLI id → the name users actually say. */
function agentLabel(a: string): string {
  return a === "codex" ? "Codex" : a === "claude-code" ? "Claude" : a;
}

function ago(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export interface PodCockpitProps {
  slug: string;
  name: string | null;
  environmentName: string;
  skills: string[];
  rules: string[];
  /** Derived from this pod's lifecycle log; null until the log has anything. */
  usage: {
    runningMs: number;
    suspendedMs: number;
    suspends: number;
    currentRunningMs: number | null;
    currentSuspendedMs: number | null;
    intervals: LifecycleInterval[];
    since: string;
  } | null;
  /** Critical, unplanned incidents (OOM, failed repair) to mark on the running
   * history — a crash is visible ON the timeline, not just in the event list. */
  crashes: { at: number; title: string }[];
  /** Momentary events that kept the pod running (updates/restarts/resizes, + OOMs it
   * survived) — thin orange marks on the timeline. */
  maintenance: { at: number; title: string }[];
  imageDigest: string | null;
  updateAvailable: boolean;
  /** Self-host only: the pod-base digest currently pulled on the host (what an update moves TO).
   * Cloud shows release notes via updateInfo; self-host has no manifest, so we show from→to digests. */
  newImageDigest?: string | null;
  /** The pod's agent CLI ("claude-code" | "codex") — drives agent-aware onboarding
   * copy and the sign-in step (Claude pastes a code back; Codex uses a device-code
   * flow shown in the terminal). */
  agent: string;
  /** Every agent this pod RUNS (multi-agent slice 3). Single-agent pods have one. */
  podAgents?: string[];
  /** Agents the env declares that this pod does NOT yet run — what "Add agent"
   * can offer. Empty means the affordance is hidden entirely. */
  addableAgents?: string[];
  /** Release-notes payload for the "what's in this update" modal; null when no
   * update is offered. Either image row may be null (built before the manifest). */
  updateInfo: UpdateInfo | null;
  /** Durable update-in-flight state from the pod row (ISO), so re-entering the
   * cockpit shows "Updating…" from the backend — not client-only. Null = not updating. */
  updatingSince: string | null;
  updateStageInitial: string | null;
  /** Which maintenance the row says is in flight, if any. Seeded durably so the
   * right word survives a refresh mid-operation. */
  maintenanceKindInitial: "update" | "resize" | null;
  status: string;
  size: PodSize;
  diskGb: number;
  lifecycle: string;
  lifecycleLocked: boolean;
  previewUrl: string | null;
  previewPublic: boolean;
  sessionUrl: string | null;
  /** Durable Claude sign-in URL (from the pod row), so the Sign-in step shows the
   * link from the backend and survives a refresh mid-login. */
  authUrl: string | null;
  authedAt: string | null;
  /** What Podbay did to this pod, newest first. */
  adminActions?: { action: string; at: string }[];
  createdAt: string;
  lastActiveAt: string;
  /** Whether the owner has finished/skipped the walkthrough (per-USER, once ever). */
  walkthroughSeen: boolean;
  /** Full classified event stream for the Activity tab (newest first). */
  activityEvents: ActivityEvent[];
  /** The OWNER's relay (their machine) — a relay serves all their pods. The INITIAL
   * snapshot; the row's RelayStatus polls for updates from here. */
  relay: MyRelayLive;
  gatewayUrl: string;
  initialStep: SetupStep;
  /** Self-host edition: the relay is a cloud-only concept (routes egress through podbay.cloud) —
   * hide it, and any other cloud-only cockpit surfaces. */
  oss?: boolean;
  /** Self-host explicit sizing (null ⇒ unlimited) — pre-fills the OSS resize chooser + labels stats. */
  cpus?: number | null;
  memoryMb?: number | null;
  /** The Docker host's capacity for the OSS resize chooser (null in cloud / when docker unreachable). */
  hostCapacity?: HostCapacity | null;
}

/** A settings row: label + description left, one control right. */
function SettingRow({
  label,
  desc,
  children,
}: {
  /** ReactNode so a row can carry an inline ⓘ beside its name, not just text. */
  label: React.ReactNode;
  desc?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[54px] items-center justify-between gap-4 border-t border-border/60 py-3.5 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-[12.5px] text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** Cockpit tab ids, also the accepted values of ?tab= (anything else → settings). */
const COCKPIT_TABS = ["settings", "secrets", "stats", "activity", "details", "admin"] as const;

export default function PodCockpit(props: PodCockpitProps) {
  const {
    slug,
    environmentName,
    skills,
    rules,
    usage,
    crashes,
    maintenance,
    imageDigest,
    updateAvailable,
    newImageDigest = null,
    agent,
    podAgents = [],
    addableAgents = [],
    updateInfo,
    updatingSince,
    updateStageInitial,
    maintenanceKindInitial,
    status,
    size,
    diskGb,
    previewUrl,
    createdAt,
    lastActiveAt,
    walkthroughSeen,
    activityEvents,
    relay,
    gatewayUrl,
    initialStep,
    oss = false,
    cpus: podCpus = null,
    memoryMb: podMemoryMb = null,
    hostCapacity = null,
    adminActions = [],
  } = props;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  // Tab state in the URL, so refreshing on Stats doesn't drop you on Settings.
  // The tab is driven by LOCAL state and the URL is synced as a side effect —
  // deriving it straight from useSearchParams made every tab click wait on a
  // router transition, which queues behind any in-flight server action (a pod
  // update takes minutes), so the tabs appeared frozen. Local state switches
  // instantly; the URL catches up whenever the router is free.
  const initialTab = (COCKPIT_TABS as readonly string[]).includes(searchParams.get("tab") ?? "")
    ? (searchParams.get("tab") as string)
    : "settings";
  const [activeTab, setActiveTab] = useState(initialTab);
  /** The tab strip, so switching can keep it in view (see selectTab). */
  const tabsRef = useRef<HTMLDivElement>(null);
  function selectTab(next: string) {
    setActiveTab(next);
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", next);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // Keep the tab strip where the eye already is. Panels differ in height by
    // hundreds of pixels (Details ~1180px vs Stats ~600px measured), and the
    // scroll container CLAMPS to the shorter panel's maximum — so switching to a
    // shorter tab dumped you near the top of the page with no explanation
    // (owner, 2026-07-29). `scroll: false` above doesn't help: the reset isn't a
    // navigation, it's the layout collapsing under you.
    // TWO frames, then explicit math. One frame ran before the new panel had laid
    // out, so `scrollIntoView` aimed at a position computed against the OLD height
    // and overshot — the strip settled ~11px ABOVE the viewport, which is the same
    // "where did the tabs go" complaint in a subtler form. The second frame is after
    // layout, and computing the container's target scrollTop ourselves cannot
    // overshoot the way an alignment hint can.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = tabsRef.current;
        const main = el?.closest("main");
        if (!el || !main) return;
        const target =
          main.scrollTop + el.getBoundingClientRect().top - main.getBoundingClientRect().top;
        main.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      });
    });
  }

  const [phase, setPhase] = useState<SetupStep>(initialStep);
  // Seeded from the durable row (props.authUrl) so a refresh mid-login still shows
  // the sign-in link; the live WS `links` frame refines it if a newer one arrives.
  const [authUrl, setAuthUrl] = useState<string | null>(props.authUrl);
  const [authCode, setAuthCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  // After the code is submitted, hold an "authenticating" state until the pod flips to authed (the
  // sign-in card unmounts then). Without a live terminal to echo the result, this is the only signal
  // the user gets that the submit took — reverting straight to "Submit code" reads as a failure.
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [sessionUrl, setSessionUrl] = useState<string | null>(props.sessionUrl);
  const [stepStartedAt, setStepStartedAt] = useState<number>(Date.now());
  const [, forceTick] = useState(0);
  const clientRef = useRef<TerminalClient | null>(null);
  const phaseRef = useRef<SetupStep>(initialStep);
  phaseRef.current = phase;

  const [previewPublic, setPreviewPub] = useState(props.previewPublic);
  const [walkthroughDone, setWalkthroughDone] = useState(false);
  // "Replay walkthrough" (from Details) forces the tour once more this session even
  // though the per-user flag says seen. Reset when the tour finishes.
  const [walkthroughReplay, setWalkthroughReplay] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [resizeTo, setResizeTo] = useState<PodSize>(size);
  // OSS live-resize state (cpus cores / memory MB; null ⇒ unlimited), seeded from the pod's current.
  const [resizeCpus, setResizeCpus] = useState<number | null>(podCpus);
  const [resizeMemoryMb, setResizeMemoryMb] = useState<number | null>(podMemoryMb);
  const [name, setName] = useState(props.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.name ?? "");
  const [removing, setRemoving] = useState(false);
  // Seeded from the DURABLE row state (updatingSince), so re-entering the cockpit
  // mid-update shows "Updating…" straight from the backend. The poll below keeps
  // it live and calls router.refresh() when the backend says it's done.
  const [updating, setUpdating] = useState(Boolean(updatingSince));
  // Optimistic suspend/resume label. These actions take several seconds (handoff +
  // provider stop/start); running them through `act()`/useTransition made the pending
  // server action block the router, freezing nav (reported live). Like runUpdate/resize,
  // we fire them OUTSIDE a transition and show local progress; cleared when the real
  // status flip lands.
  const [lifecycleBusy, setLifecycleBusy] = useState<null | "suspend" | "resume">(null);
  useEffect(() => {
    setLifecycleBusy(null);
  }, [status]);
  const [updateStage, setUpdateStage] = useState<string | null>(updateStageInitial);
  const [maintenanceKind, setMaintenanceKind] = useState<"update" | "resize" | null>(
    maintenanceKindInitial,
  );
  // One transient concept, two kinds, read from the row rather than parsed out of a
  // stage string. The prefix version worked but made a string a contract between the
  // control plane and this component — the kind of coupling nobody remembers.
  const transientKind = maintenanceKind === "resize" ? "resizing" : "updating";
  const [updateStartedAt, setUpdateStartedAt] = useState<number | null>(
    updatingSince ? Date.parse(updatingSince) : null,
  );
  const savingName = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: React.ReactNode;
    /** Amber callout for actions that cut a live agent session (update/suspend).
     * Rendered as its own block, NOT inside AlertDialogDescription — that is a
     * <p>, and a <div> inside it is invalid HTML. */
    warning?: React.ReactNode;
    confirmLabel: string;
    danger?: boolean;
    run: () => void;
  } | null>(null);

  // Agent-aware onboarding. Claude and Codex sign in DIFFERENTLY: Claude shows an
  // auth URL and you paste a code back into the CLI; Codex uses a device-code flow
  // (open a link, enter a one-time code on OpenAI's site — nothing pasted back),
  // shown live in the terminal.
  const isCodex = agent === "codex";
  // Multi-agent (slice 3): the cockpit renders CONNECTION state, not agent count.
  const agentsOnPod = podAgents.length ? podAgents : [agent];
  const [addingAgent, setAddingAgent] = useState<string | null>(null);
  const agentName = isCodex ? "Codex" : "Claude";
  const subscription = isCodex ? "OpenAI" : "Claude";

  const onboarding = phase !== "ready";
  // The once-per-USER connect tour: shown at ready, before it's been seen/dismissed —
  // or on explicit replay. Once seen on any pod it never re-pops on a new one.
  const showWalkthrough =
    !onboarding && !walkthroughDone && (walkthroughReplay || !walkthroughSeen);
  // Mark it seen the INSTANT it appears (not only on Done) so a refresh before the
  // owner clicks through doesn't re-pop it. Fire-and-forget; idempotent server-side.
  // Skip while replaying — replay shouldn't re-stamp (it's already stamped).
  useEffect(() => {
    if (showWalkthrough && !walkthroughReplay) void markWalkthroughSeen();
  }, [showWalkthrough, walkthroughReplay]);
  // The terminal WS should stay up across running↔waking↔provisioning changes —
  // only the SUSPENDED boundary matters. Keying the connect effect on this
  // boolean (not raw `status`) stops a status flap (resume transitions, the
  // reconcile sweep) from tearing down + rebuilding the terminal every time.
  const connectable = !!gatewayUrl && status !== "suspended";
  const display = name?.trim() || slug;

  useEffect(() => setStepStartedAt(Date.now()), [phase]);

  useEffect(() => {
    if (!onboarding) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [onboarding]);

  useEffect(() => {
    const transitional = status === "provisioning" || status === "waking";
    if ((!onboarding && !transitional) || editing) return;
    const t = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 3500);
    return () => clearInterval(t);
  }, [onboarding, status, router, editing]);

  useEffect(() => {
    // A suspended pod stays down until the owner clicks Resume (explicit
    // suspend/resume — the gateway no longer auto-wakes on connect, and it now
    // rejects a terminal WS to a suspended pod with 409). So don't even dial: a
    // suspended pod is past onboarding and its session URL is already persisted.
    // Resume is the only wake path; status then flips to running and this
    // reconnects. The live status/links stream is only needed while onboarding
    // or running.
    if (!connectable) return;
    const client = new TerminalClient({ gatewayUrl, podId: slug });
    clientRef.current = client;
    client.on("status", (s) => {
      const cred = s.cred;
      if (!cred) return;
      if (!cred.authed && phaseRef.current === "creating") setPhase("login");
      if (cred.authed && (phaseRef.current === "creating" || phaseRef.current === "login")) {
        setPhase("agent");
      }
    });
    client.on("links", (urls) => {
      for (const u of urls) {
        if (isSessionUrl(u)) setSessionUrl(u);
        else if (isAuthUrl(u)) setAuthUrl(u);
      }
    });
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
    // Keyed on `connectable` (suspended boundary), not raw status, so
    // running↔waking flaps don't reconnect. gatewayUrl/slug are stable props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, connectable]);

  useEffect(() => {
    if (sessionUrl && phase !== "ready") setPhase("ready");
  }, [sessionUrl, phase]);

  // Adopt the SERVER's step when it has moved ahead of ours. `phase` is seeded from
  // `initialStep` with useState, which ignores later prop values — so without this the
  // 3.5s router.refresh() re-derives the right step server-side and the client happily
  // ignores it. The only other way out of "creating" is a credential frame over the
  // terminal WS, so any WS problem pinned the cockpit on "Create" forever (seen live on
  // civic-turkey-be0b). Forward-only: never drag the user back a step, since the client
  // legitimately runs ahead of durable state (e.g. it saw the agent start before
  // authedAt was persisted).
  useEffect(() => {
    const order: SetupStep[] = ["creating", "login", "agent", "ready"];
    if (order.indexOf(initialStep) > order.indexOf(phaseRef.current)) setPhase(initialStep);
  }, [initialStep]);

  // Suspending ends the pod's Claude session, and the resume brings up a NEW one
  // with a NEW hand-off URL. The poll below only runs while we DON'T have a URL,
  // so without this the client kept serving the pre-suspend link and "Continue in
  // Claude" opened a dead session until a manual refresh (reported 2026-07-23).
  // Drop the held link the moment the pod stops running; the poll refills it on
  // the way back up.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "running" && status !== "running") setSessionUrl(null);
    prevStatus.current = status;
  }, [status]);

  // Image-update progress. The action returns as soon as the update STARTS, so
  // the real stage + elapsed come from polling the event-derived progress. This
  // is what makes the update legible instead of a button stuck on "Updating…".
  const updateElapsed = updateStartedAt ? Math.round((Date.now() - updateStartedAt) / 1000) : 0;
  useEffect(() => {
    if (!updating) return;
    let stop = false;
    const tick = async () => {
      const p = await podUpdateProgress(slug).catch(() => null);
      if (stop || !p) return;
      setUpdateStage(p.stage);
      if (p.startedAt) setUpdateStartedAt(Date.parse(p.startedAt));
      if (!p.active) {
        setUpdating(false);
        if (p.error) setActionError(`Couldn't update: ${p.error}`);
        else router.refresh();
      }
    };
    void tick();
    const poll = setInterval(tick, 3000);
    const secs = setInterval(() => forceTick((n) => n + 1), 1000); // elapsed counter
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(secs);
    };
  }, [updating, slug, router]);

  // The RC hand-off link: this CLI version never streams a "links" frame to the
  // client, so the WS handler above never fires. The server DOES capture the URL
  // (reconcile reads /healthz). Poll for it while we don't have one and the pod
  // is running — surfaces "Continue in Claude" and advances onboarding. Bounded
  // so a pod that never enables RC doesn't poll forever.
  useEffect(() => {
    if (sessionUrl || status !== "running") return;
    let tries = 0;
    let stop = false;
    const poll = async () => {
      const url = await getPodSessionUrl(slug).catch(() => null);
      if (url && !stop) setSessionUrl(url);
    };
    void poll(); // immediately — the URL is usually already captured server-side
    const t = setInterval(() => {
      if (stop || ++tries > 45) return clearInterval(t); // ~4 min at 5s
      void poll();
    }, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [sessionUrl, status, slug]);

  // Poll the captured sign-in value during the login step. Claude gets its auth
  // URL live via the WS "links" frame above, but a Codex pod's one-time device
  // CODE is scraped from the terminal by the GATEWAY and persisted server-side —
  // no frame reaches this client — so without this poll the panel sits at
  // "Getting your sign-in code…" forever even though the code is already in the DB
  // (seen live on improved-tapir-143b, 2026-07-25). Stops as soon as a value lands.
  useEffect(() => {
    if (authUrl || phase !== "login" || status !== "running") return;
    let tries = 0;
    let stop = false;
    const poll = async () => {
      const v = await getPodAuthUrl(slug).catch(() => null);
      if (v && !stop) setAuthUrl(v);
    };
    void poll(); // immediately — the code is often already captured server-side
    const t = setInterval(() => {
      if (stop || ++tries > 90) return clearInterval(t); // ~4.5 min at 3s
      void poll();
    }, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [authUrl, phase, status, slug]);

  useEffect(() => {
    if (phase !== "agent") return;
    // Match the SERVER's ready-wait window (deriveSetupStep uses the same
    // agent-aware value), so the client's "call it ready" moment agrees with what
    // a refresh re-derives — otherwise there was a gap where the client showed
    // "ready" but reloading reverted to "agent". Codex has no RC session URL to
    // wait for, so it flips to ready after a short grace instead of the 90s RC
    // fallback (which left the cockpit on "Starting your agent" while Codex was
    // already answering).
    const wait = readyWaitMsForAgent(agent);
    const t = setInterval(() => {
      if (Date.now() - stepStartedAt > wait) setPhase("ready");
    }, 1000);
    return () => clearInterval(t);
  }, [phase, stepStartedAt, agent]);

  const elapsed = Math.floor((Date.now() - stepStartedAt) / 1000);

  function submitCode() {
    const code = authCode.trim();
    if (!code) return;
    if (clientRef.current) {
      // Live terminal WS: type the code straight into the PTY.
      clientRef.current.sendInput(code);
      window.setTimeout(() => clientRef.current?.sendInput("\r"), 500);
    } else {
      // No terminal WS (self-host without the gateway's browser↔pod terminal proxy): send the code
      // via the pod-agent input action, which types it into the agent's window over HTTP.
      void sendAgentSigninCode(slug, agent, code);
    }
    setCodeSent(true);
    setAuthSubmitting(true);
    window.setTimeout(() => setCodeSent(false), 2000); // "Sent ✓" flashes, then → "Authenticating…"
    // Fall back to a re-enabled button if the code didn't take (wrong/expired), so the user can retry.
    window.setTimeout(() => setAuthSubmitting(false), 45000);
  }

  const act = (fn: () => Promise<{ error?: string } | void>, label: string) => {
    setActionError(null);
    start(async () => {
      const r = await fn();
      if (r && "error" in r && r.error) setActionError(`Couldn't ${label}: ${r.error}`);
      router.refresh();
    });
  };

  /** Start the image update. Extracted so the merged dialog and the no-manifest
   * fallback confirm run the SAME thing. */
  const runUpdate = () => {
    setUpdating(true);
    setUpdateStage(null);
    setMaintenanceKind("update");
    setUpdateStartedAt(Date.now());
    setActionError(null);
    track("pod_update_initiated", { pod_id: slug, environment: environmentName });
    // NOT wrapped in start()/useTransition: the action returns immediately and a
    // transition would re-couple the button to the router. Progress arrives via
    // the poll below.
    void updatePodImage(slug).then((r) => {
      if (r?.error) {
        setUpdating(false);
        setActionError(`Couldn't update: ${r.error}`);
      }
    });
  };

  const saveName = () => {
    if (savingName.current) return;
    setEditing(false);
    const next = draft.trim();
    if (next === (name ?? "")) return;
    savingName.current = true;
    setName(next || null);
    void renamePod(slug, next)
      .then((r) => {
        if (r?.error) setActionError(`Couldn't rename: ${r.error}`);
      })
      .finally(() => {
        savingName.current = false;
      });
  };

  const agentsLabel = (podAgents ?? [agent]).join(", ");

  // During a transition the cockpit IS the transition — replace it wholesale rather than
  // disabling controls in place. Gated AFTER all hooks (React rules), so the update-poll and
  // WS effects keep running; when the state clears, this falls through to the cockpit below.
  // Not while onboarding — that has its own guided setup flow.
  if (updating && !onboarding) {
    return (
      <PodUpdating
        name={name}
        slug={slug}
        environmentName={environmentName}
        agentsLabel={agentsLabel}
        kind={transientKind === "resizing" ? "resize" : "update"}
        stage={updateStage}
        elapsedSec={updateElapsed}
        updateInfo={updateInfo}
      />
    );
  }
  if (status === "suspended") {
    return (
      <PodSuspended
        name={name}
        slug={slug}
        environmentName={environmentName}
        agentsLabel={agentsLabel}
        sizeLabel={labelForPod(size, diskGb)}
        currentSuspendedMs={usage?.currentSuspendedMs ?? null}
        runningMs={usage?.runningMs ?? 0}
        suspends={usage?.suspends ?? 0}
        lastActiveAt={lastActiveAt}
        onResume={() => {
          setConfirm({
            title: `Resume ${name?.trim() || slug}?`,
            message: "It starts using compute again and counts toward your slots.",
            confirmLabel: "Resume",
            run: () => {
              track("pod_resumed", { pod_id: slug, environment: environmentName });
              act(() => wakePod(slug), "resume");
            },
          });
        }}
        resuming={pending}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot status={updating ? transientKind : status} />
          {editing ? (
            <Input
              autoFocus
              data-testid="cockpit-rename"
              value={draft}
              maxLength={60}
              placeholder={slug}
              className="h-9 max-w-xs text-xl font-bold"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setDraft(name ?? "");
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              data-testid="cockpit-name"
              className="group flex min-w-0 items-center gap-1.5 text-xl font-bold tracking-tight"
              title="Rename"
              onClick={() => {
                setDraft(name ?? "");
                setEditing(true);
              }}
            >
              <span className="truncate">{display}</span>
              <Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[19px] text-[13px] text-muted-foreground">
          <StatusBadge status={updating ? transientKind : status} />
          <span className="ml-1">{environmentName}</span>
          <span>· active {ago(lastActiveAt)}</span>
        </div>
      </header>

      {/* Onboarding hero — the only prominent CTA until ready */}
      {onboarding && (
        <div className="flex flex-col gap-1.5">
          <WizardProgress current={phase} />

          {phase === "creating" && (
            <Card>
              <CardHeader>
                <CardTitle>Building your machine</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3.5">
                <ProvisionStages sinceMs={Date.now() - Date.parse(createdAt)} agent={agent} />
                <p className="text-[13px] text-muted-foreground">
                  A real machine with persistent storage, booting from scratch. Next you’ll sign in
                  to {agentName} — once, for this pod’s lifetime.
                </p>
              </CardContent>
            </Card>
          )}

          {phase === "login" && isCodex && (
            <Card>
              <CardHeader>
                <CardTitle>Sign in to Codex</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  This pod runs Codex on <strong className="text-foreground">your</strong> OpenAI
                  subscription. Sign in once — the login stays with this pod for its whole life.
                </p>
                {/* For a Codex pod, `authUrl` carries the DEVICE CODE (the URL is
                    static). Show it once captured; a spinner until then. */}
                {authUrl ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-primary bg-primary/10 px-[18px] py-4">
                    <div className="text-sm text-muted-foreground">
                      1. Copy this code &nbsp; 2. Open OpenAI and enter it to authorize:
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <CopyCodeButton
                        code={authUrl}
                        className="px-3 py-2 text-lg tracking-[0.15em]"
                      />
                      <Button asChild variant="outline">
                        <a
                          href="https://auth.openai.com/codex/device"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open OpenAI sign-in ↗
                        </a>
                      </Button>
                    </div>
                    <div className="text-[13px] text-muted-foreground">
                      Sign in with your OpenAI/ChatGPT account — this page continues automatically.
                    </div>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-base leading-normal">
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    <span>
                      Getting your sign-in code… <span className="text-muted-foreground">{elapsed}s</span>
                    </span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {phase === "login" && !isCodex && (
            <Card>
              <CardHeader>
                <CardTitle>Sign in to Claude</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  This pod runs Claude on <strong className="text-foreground">your</strong>{" "}
                  subscription. Sign in once — the login stays with this pod for its whole life.
                </p>
                {authUrl ? (
                  <a
                    className="flex flex-col gap-0.5 rounded-xl border border-primary bg-primary/10 px-[18px] py-4 transition-shadow hover:shadow-[0_0_0_3px_rgba(47,107,255,0.18)]"
                    href={authUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="text-lg font-semibold">Open the Claude sign-in page</span>
                    <span className="text-sm text-[var(--accent-light)]">then copy the code it gives you ↗</span>
                  </a>
                ) : (
                  <div className="flex items-start gap-3 text-base leading-normal">
                    <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" />
                    <span>
                      Getting your sign-in link… <span className="text-muted-foreground">{elapsed}s</span>
                      <br />
                      <span className="text-[13px] text-muted-foreground">
                        {elapsed < 6
                          ? "Starting Claude in the pod…"
                          : elapsed < 20
                            ? "Requesting a sign-in link from Claude…"
                            : "Still working — this can take up to a minute on first boot."}
                      </span>
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-muted-foreground" htmlFor="authcode">
                    Paste the code Claude gives you
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="authcode"
                      className="flex-1 font-mono"
                      value={authCode}
                      onChange={(e) => setAuthCode(e.target.value)}
                      placeholder="Authorization code"
                      autoComplete="off"
                      spellCheck={false}
                      onKeyDown={(e) => e.key === "Enter" && submitCode()}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Paste"
                      title="Paste from clipboard"
                      onClick={async () => {
                        try {
                          const t = await navigator.clipboard.readText();
                          if (t) setAuthCode(t.trim());
                        } catch {
                          /* clipboard unavailable / denied — user can paste manually */
                        }
                      }}
                    >
                      <ClipboardPaste />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    className="self-start"
                    onClick={submitCode}
                    disabled={!authCode.trim() || authSubmitting}
                  >
                    {codeSent ? (
                      "Sent ✓"
                    ) : authSubmitting ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin" /> Authenticating…
                      </>
                    ) : (
                      "Submit code"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {phase === "agent" && (
            <Card>
              <CardHeader>
                <CardTitle>Starting your agent</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3.5">
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
                  <span>
                    {isCodex ? (
                      <>
                        Signed in ✓ — finishing setup and starting Codex. This happens
                        automatically; the page updates the moment it&rsquo;s ready.
                      </>
                    ) : (
                      <>
                        Signed in ✓ — now enabling remote control so you can steer this pod from the
                        Claude app. This connects automatically; the page updates the moment
                        it&rsquo;s ready.
                      </>
                    )}
                  </span>
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Ready state (multi-agent redesign, 2026-07-28): Preview is the only
          pod-level action — the agents' own apps are how you reach a pod, and the
          terminal lives in the Admin tab (last resort, not access). Below it, one
          self-contained card per agent (AgentCards), then the add-agent offer as a
          quiet ghost card. */}
      {!onboarding && (
        <div className="flex flex-col gap-2.5">
          {/* Above everything in the ready state: if the pod itself is unwell, that
              outranks its preview and its agents. Renders nothing when healthy. */}
          <HealthStrip slug={slug} running={status === "running"} />
          {previewUrl && (
            <PreviewCard
              slug={slug}
              url={previewUrl}
              isPublic={previewPublic}
              running={status === "running"}
            />
          )}
          <AgentCards
            slug={slug}
            podName={props.name}
            status={status}
            primaryAgent={agent}
            agentsOnPod={agentsOnPod}
            sessionUrl={sessionUrl}
            authedAt={props.authedAt}
            updateAvailable={updateAvailable}
            onConfirm={setConfirm}
          />
          {addableAgents.length > 0 && status === "running" && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-3">
              <span className="text-[13px] text-muted-foreground">Room for a second agent</span>
              {addableAgents.map((a) => (
                <Button
                  key={a}
                  variant="outline"
                  size="sm"
                  disabled={addingAgent !== null}
                  onClick={() =>
                    setConfirm({
                      title: `Add ${agentLabel(a)} to this pod?`,
                      message: (
                        <>
                          It starts in its own terminal tab, alongside{" "}
                          {agentLabel(agent)} — which keeps running, uninterrupted.
                        </>
                      ),
                      warning: (
                        <>
                          Both agents share this pod&rsquo;s <strong>workspace</strong> and preview
                          port. Switch between them rather than running both at once on the same
                          files.
                        </>
                      ),
                      confirmLabel: `Add ${agentLabel(a)}`,
                      run: () => {
                        setAddingAgent(a);
                        setActionError(null);
                        track("pod_agent_added", { pod_id: slug, environment: environmentName, agent: a });
                        void addPodAgent(slug, a)
                          .then((r) => {
                            if (r?.error) setActionError(`Couldn't add ${agentLabel(a)}: ${r.error}`);
                            else router.refresh();
                          })
                          .finally(() => setAddingAgent(null));
                      },
                    })
                  }
                >
                  {addingAgent === a ? (
                    <>
                      <Loader2 className="animate-spin" /> Adding…
                    </>
                  ) : (
                    `+ Add ${agentLabel(a)}`
                  )}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controls — tabbed: Settings / Details / Admin. The active tab lives in
          ?tab= so a refresh (or a shared link) stays where you were instead of
          snapping back to Settings. */}
      {/* The cockpit controls appear only once the pod is READY. While it's still
          creating or the user is signing the agent in, the guided setup above is the
          whole story — the tabs would just be noise (and half of them can't act on a
          pod that isn't up yet). */}
      {!onboarding && (
      <div ref={tabsRef} className="scroll-mt-4">
      <Tabs value={activeTab} onValueChange={selectTab}>
        <TabsList variant="line" className="mb-4 gap-5">
          <TabsTrigger value="settings" className="flex-none px-0" data-tour="tab-settings">Settings</TabsTrigger>
          <TabsTrigger value="secrets" className="flex-none px-0" data-tour="tab-secrets">Secrets</TabsTrigger>
          <TabsTrigger value="stats" className="flex-none px-0" data-tour="tab-stats">Stats</TabsTrigger>
          <TabsTrigger value="activity" className="flex-none px-0" data-tour="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="details" className="flex-none px-0" data-tour="tab-details">Details</TabsTrigger>
          <TabsTrigger value="admin" className="flex-none px-0" data-tour="tab-admin">Admin</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="min-h-[20rem]">
          <Card className="gap-1 py-4">
            <CardContent className="py-0">
          <SettingRow
            label="Software"
            /* Say WHAT the update contains, not just that one exists — the owner
               shouldn't have to open a dialog to find out whether it's worth a
               restart. Falls back to the generic line when no notes were recorded. */
            desc={
              updateAvailable
                ? oss && !updateInfo
                  ? // Self-host: no release-notes manifest, so show the concrete from→to build
                    // digests (that IS the version info here) plus what's preserved.
                    `New pod-base available · ${imageDigest ? shortDigest(imageDigest) : "?"} → ${
                      newImageDigest ? shortDigest(newImageDigest) : "latest"
                    } — your files, plan and sign-in are kept`
                  : [
                      updateHeadline(updateInfo?.target?.summary, updateInfo?.target?.notes),
                      "your files, plan and sign-in are kept",
                    ].join(" — ")
                : imageDigest
                  ? `Up to date · ${shortDigest(imageDigest)}`
                  : "Version unknown"
            }
          >
            {updateAvailable ? (
              <div className="flex flex-col items-end gap-1">
              {/* ⓘ (what updating does — kept/happens, static) sits BESIDE Update; the
                  Update modal itself now carries only the changelog + confirm, so it
                  stays short. The two were merged once to avoid duplicate copy, but the
                  merged modal grew too tall for a phone — split again, no overlap. */}
              <div className="flex items-center gap-1.5">
              <UpdateBasicsDialog />
              {updateInfo ? (
                <UpdateInfoDialog
                  info={updateInfo}
                  warning={SESSION_INTERRUPT_WARNING}
                  busy={pending || updating}
                  onConfirm={runUpdate}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                      disabled={pending || updating}
                    >
                      {updating ? "Updating…" : "Update"}
                    </Button>
                  }
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                  disabled={pending || updating}
                  onClick={() =>
                    // No manifest row for this image (built before the manifest, or
                    // not recorded yet) — there is nothing to show, so fall back to
                    // the plain confirm rather than an empty dialog.
                    setConfirm({
                      title: "Update this pod?",
                      message: (
                        <>
                          {oss && (imageDigest || newImageDigest) && (
                            <span className="mb-2 block font-mono text-[12px] text-muted-foreground">
                              {imageDigest ? shortDigest(imageDigest) : "?"} →{" "}
                              {newImageDigest ? shortDigest(newImageDigest) : "latest"}
                            </span>
                          )}
                          Your files, your agent&rsquo;s plan and your sign-in are{" "}
                          <strong>kept</strong>. The pod hands its state off and restarts — the
                          current chat ends and your agent resumes. Usually 2–3 minutes.
                        </>
                      ),
                      warning: SESSION_INTERRUPT_WARNING,
                      confirmLabel: "Update and restart",
                      run: runUpdate,
                    })
                  }
                >
                  {updating ? "Updating…" : "Update"}
                </Button>
              )}
              </div>
              {updating && (
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {updateStage ?? "starting"} · {updateElapsed}s
                </span>
              )}
              </div>
            ) : (
              <span className="text-[12.5px] text-muted-foreground">—</span>
            )}
          </SettingRow>
          <SettingRow
            label="Suspend"
            desc={
              status === "suspended"
                ? "Suspended — click Resume to start it again"
                : "Running 24/7 — suspend to free compute for another pod"
            }
          >
            {status === "suspended" ? (
              <Button
                variant="outline"
                size="sm"
                className="border-success/40 text-success hover:bg-success/10 hover:text-success"
                disabled={pending || updating || lifecycleBusy !== null}
                onClick={() => {
                  track("pod_resumed", { pod_id: slug, environment: environmentName });
                  setActionError(null);
                  setLifecycleBusy("resume");
                  // Decoupled from the router transition (see lifecycleBusy note): awaiting
                  // this inside useTransition froze navigation.
                  void wakePod(slug).then((r) => {
                    if (r && "error" in r && r.error) {
                      setLifecycleBusy(null);
                      setActionError(`Couldn't resume: ${r.error}`);
                    } else {
                      router.refresh();
                    }
                  });
                }}
              >
                {lifecycleBusy === "resume" ? "Resuming…" : "Resume"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                disabled={pending || updating || lifecycleBusy !== null || status !== "running" || onboarding}
                onClick={() =>
                  setConfirm({
                    title: "Suspend this pod?",
                    message:
                      "It pauses to free compute for another pod. Your files and Claude login are kept. It stays suspended until you click Resume — nothing else wakes it, so the Claude app (and any preview) stay disconnected until then.",
                    warning: SESSION_INTERRUPT_WARNING,
                    confirmLabel: "Suspend",
                    run: () => {
                      track("pod_suspended", { pod_id: slug, environment: environmentName });
                      setActionError(null);
                      setLifecycleBusy("suspend");
                      // Fire OUTSIDE the router transition (see lifecycleBusy note): the
                      // handoff + provider.sleep take seconds; awaiting inside useTransition
                      // blocked the router and froze the whole page.
                      void sleepPod(slug).then((r) => {
                        if (r && "error" in r && r.error) {
                          setLifecycleBusy(null);
                          setActionError(`Couldn't suspend: ${r.error}`);
                        } else {
                          router.refresh();
                        }
                      });
                    },
                  })
                }
              >
                {lifecycleBusy === "suspend" ? "Suspending…" : "Suspend"}
              </Button>
            )}
          </SettingRow>
          {/* Say WHY everything is dead. A settings pane full of disabled controls
              with no explanation reads as a broken page, not as a busy pod. */}
          {updating && (
            <p className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
              {transientKind === "resizing" ? "Resizing" : "Updating"} this pod — settings are
              read-only until it finishes.
            </p>
          )}
          <SettingRow
            label={oss ? "Resources" : "Size"}
            desc={
              oss
                ? `${podCpus != null ? `${podCpus} vCPU` : "CPU: no limit"} · ${
                    podMemoryMb != null
                      ? `${(podMemoryMb / 1024).toFixed(podMemoryMb % 1024 ? 1 : 0)} GB RAM`
                      : "RAM: no limit"
                  }`
                : `${labelForPod(size, diskGb)} — reserved compute`
            }
          >
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              <Button
                variant="outline"
                size="sm"
                disabled={
                  pending || onboarding || updating || (status !== "running" && status !== "suspended")
                }
                onClick={() => {
                  setResizeTo(size);
                  setResizeCpus(podCpus);
                  setResizeMemoryMb(podMemoryMb);
                  setResizeOpen(true);
                }}
              >
                {transientKind === "resizing" && updating ? "Resizing…" : "Change"}
              </Button>
              {/* Progress belongs HERE, not under Software: a resize showed nothing
                  at all, so the pod read "Running" for the minutes it was down. */}
              {updating && transientKind === "resizing" && (
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {updateStage ?? "starting"} · {updateElapsed}s
                </span>
              )}
            </div>
          </SettingRow>

          {previewUrl && (
            <SettingRow label="Preview access" desc={previewPublic ? "Anyone with the URL" : "Only you"}>
              <Button
                variant="outline"
                size="sm"
                disabled={pending || updating}
                onClick={() => {
                  setPreviewPub((v) => !v);
                  act(() => setPodPreviewPublic(slug, !previewPublic), "update preview");
                }}
              >
                {previewPublic ? "Make private" : "Make public"}
              </Button>
            </SettingRow>
          )}

          {/* Relay is cloud-only (routes egress via podbay.cloud); a self-host pod already
              egresses from the owner's own network, so hide it in OSS. */}
          {!oss && (
            <SettingRow
              label={
                <span className="inline-flex items-center gap-1">
                  Relay
                  <RelayInfoDialog />
                </span>
              }
              desc="Reach sites that block datacenters, through your own computer"
            >
              {/* One live component owns the whole right side — connected/not, tunnel
                  health, usage — and polls so it stays current without a button. */}
              <RelayStatus initial={relay} settingsHref="/dashboard/settings" />
            </SettingRow>
          )}

          <GithubConnect slug={slug} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="secrets" className="min-h-[20rem]">
          <Card>
            <CardContent>
              <SecretsPanel slug={slug} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="min-h-[20rem]">
          <Card className="gap-1 py-4">
            <CardContent className="py-0">
              <PodStats slug={slug} oss={oss} cpus={podCpus} memoryMb={podMemoryMb} />
              {/* A SINCE-LAUNCH lifecycle view — deliberately a different span from
                  the windowed charts above, so it's labeled and divided off rather
                  than stacked flush (which read as one continuous 24h timeline). */}
              {usage && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-medium text-muted-foreground">
                      Running history
                    </span>
                    <span className="text-[10.5px] text-muted-foreground/60">since launch</span>
                  </div>
                  <LifecycleTimeline
                    intervals={usage.intervals}
                    suspends={usage.suspends}
                    crashes={crashes}
                    maintenance={maintenance}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="min-h-[20rem]">
          <ActivityTab slug={slug} initialEvents={activityEvents} running={status === "running"} />
        </TabsContent>

        <TabsContent value="details" className="min-h-[20rem]">
          <Card className="gap-1 py-4">
            <CardContent className="py-0">
          {[
            ["Slug", <span key="s" className="font-mono text-[12.5px]">{slug}</span>],
            ["Environment", environmentName],
            ["Created", ago(createdAt)],
            // Only shown once Podbay has actually done something (an update, resize,
            // repair) — the empty "nobody has changed this" row was noise, and it
            // truncated to an ellipsis. When present it's real transparency: the owner
            // sees what WE did to their pod.
            ...(adminActions.length > 0
              ? [
                  [
                    "Podbay activity",
                    <span key="aa" className="flex flex-col items-end gap-0.5 text-right">
                      {adminActions.slice(0, 3).map((a) => (
                        <span key={a.at} className="text-[12.5px]">
                          Podbay did {a.action} · {ago(a.at)}
                        </span>
                      ))}
                    </span>,
                  ] as [string, React.ReactNode],
                ]
              : []),
            ["Claude login", props.authedAt ? "Signed in" : "Not yet"],
          ].map(([label, value]) => (
            <div
              key={label as string}
              className="flex items-center justify-between gap-4 border-t border-border/60 py-3.5 text-sm first:border-t-0"
            >
              <span className="font-medium">{label}</span>
              <span className="min-w-0 truncate text-right text-muted-foreground">{value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 border-t border-border/60 py-3.5 text-sm">
            <span className="font-medium">Walkthrough</span>
            <button
              type="button"
              onClick={() => {
                setWalkthroughDone(false);
                setWalkthroughReplay(true);
              }}
              className="text-[var(--accent-light)] hover:underline"
            >
              Replay walkthrough
            </button>
          </div>
          {previewUrl && (
            <div className="flex items-center justify-between gap-4 border-t border-border/60 py-3.5 text-sm">
              <span className="font-medium">Preview URL</span>
              <a
                className="min-w-0 truncate text-right text-[var(--accent-light)] hover:underline"
                href={previewUrl}
                target="_blank"
                rel="noopener"
              >
                {previewUrl.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
          {skills.length > 0 && (
            <div className="flex items-start justify-between gap-4 border-t border-border/60 py-3.5 text-sm">
              <span className="shrink-0 font-medium">Skills</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {skills.map((s) => (
                  <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>
                ))}
              </div>
            </div>
          )}
          {rules.length > 0 && (
            <div className="flex items-start justify-between gap-4 border-t border-border/60 py-3.5 text-sm">
              <span className="shrink-0 font-medium">Rules</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {rules.map((r) => (
                  <Badge key={r} variant="secondary" className="font-normal">{r}</Badge>
                ))}
              </div>
            </div>
          )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admin" className="min-h-[20rem]">
          <Card className="gap-1 py-4">
            <CardContent className="py-0">
              {/* The full check list lives here, not on the happy path — same rule
                  as the terminal: routine use never meets the machinery. */}
              <div className="border-b border-border/60 py-3.5">
                <div className="mb-2 text-sm font-medium">Pod health</div>
                <HealthPanel slug={slug} running={status === "running"} onConfirm={setConfirm} />
              </div>
              <SettingRow label="Terminal" desc="Raw web terminal — the backup / power surface">
                <Button asChild variant="outline" size="sm">
                  <a href={`/pods/${slug}`} target="_blank" rel="noopener">
                    Open <ArrowUpRight />
                  </a>
                </Button>
              </SettingRow>
              <SettingRow label="Delete this pod" desc="Machine, volume, and login — gone for good">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={pending || removing || updating}
              onClick={() =>
                setConfirm({
                  title: "Delete this pod?",
                  message: (
                    <>
                      The machine, its volume, and its Claude login are removed{" "}
                      <strong>for good</strong>. This can’t be undone.
                    </>
                  ),
                  confirmLabel: "Delete pod",
                  danger: true,
                  run: () => {
                    setRemoving(true);
                    setActionError(null);
                    track("pod_deleted", { pod_id: slug, environment: environmentName });
                    start(async () => {
                      const r = await destroyPod(slug);
                      if (r?.error) {
                        setRemoving(false);
                        setActionError(`Couldn't delete pod: ${r.error}`);
                      } else {
                        router.push("/dashboard");
                      }
                    });
                  },
                })
              }
            >
              {removing ? "Deleting…" : "Delete"}
            </Button>
          </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
      )}

      {actionError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {actionError}
        </p>
      )}


      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            {confirm?.message && <AlertDialogDescription>{confirm.message}</AlertDialogDescription>}
            {confirm?.warning && (
              <div
                role="note"
                className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-left text-[13px] text-warning"
              >
                <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
                <span>{confirm.warning}</span>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.danger ? "destructive" : "default"}
              onClick={() => {
                confirm?.run();
                setConfirm(null);
              }}
            >
              {confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resizeOpen} onOpenChange={setResizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resize pod</AlertDialogTitle>
            <AlertDialogDescription>
              {oss
                ? "Change CPU and memory live — applied instantly, no restart. Going back to “No limit” isn’t supported here (it would recreate the pod and lose its data); set a positive value."
                : "Applying a new size restarts the pod (a minute or two) — your work and login are kept. CPU and RAM change to the tier; disk can only grow."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {oss ? (
            <HostResourceChooser
              capacity={hostCapacity}
              cpus={resizeCpus}
              memoryMb={resizeMemoryMb}
              onCpus={setResizeCpus}
              onMemoryMb={setResizeMemoryMb}
            />
          ) : (
            <SizePicker
              value={resizeTo}
              onChange={setResizeTo}
              note={(s) => (POD_TIERS[s].diskGb < diskGb ? `keeps ${diskGb} GB disk` : null)}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {oss ? (
              <AlertDialogAction
                disabled={resizeCpus === podCpus && resizeMemoryMb === podMemoryMb}
                onClick={() => {
                  setResizeOpen(false);
                  if (resizeCpus === podCpus && resizeMemoryMb === podMemoryMb) return;
                  setActionError(null);
                  // Live: applies via docker update (no restart). Refresh so the new limits +
                  // stats reflect immediately; the control plane refuses removing a limit.
                  void resizePodLive(slug, { cpus: resizeCpus, memoryMb: resizeMemoryMb }).then((r) => {
                    if (r?.error) setActionError(`Couldn’t resize: ${r.error}`);
                    else router.refresh();
                  });
                }}
              >
                Apply
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                disabled={resizeTo === size}
                onClick={() => {
                  setResizeOpen(false);
                  if (resizeTo === size) return;
                  // Same shape as runUpdate: mark it in-flight locally so the state and
                  // progress render immediately, and do NOT wrap it in a transition —
                  // the action returns as soon as the pod is marked, and progress
                  // arrives via the poll. Wrapping it (which is what `act` does) is why
                  // a resize used to show nothing at all until it had finished.
                  setUpdating(true);
                  setUpdateStage("stopping");
                  setMaintenanceKind("resize");
                  setUpdateStartedAt(Date.now());
                  setActionError(null);
                  void resizePod(slug, resizeTo).then((r) => {
                    if (r?.error) {
                      setUpdating(false);
                      setActionError(`Couldn't resize: ${r.error}`);
                    }
                  });
                }}
              >
                {resizeTo === size ? "No change" : `Resize to ${POD_TIERS[resizeTo].label}`}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* First arrival at ready: a once-per-pod coach-mark tour of how to connect.
          Marked seen on show (effect above); Done just closes it. */}
      {showWalkthrough && (
        <ConnectWalkthrough
          agents={agentsOnPod}
          onDone={() => {
            setWalkthroughDone(true);
            setWalkthroughReplay(false);
          }}
        />
      )}
    </div>
  );
}
