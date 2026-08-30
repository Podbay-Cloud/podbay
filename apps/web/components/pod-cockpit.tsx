"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PodLiveSignals } from "@podbay/control-plane";
import { apiGet } from "@/lib/api-fetch";
import { qk } from "@/lib/query-keys";
import { scrollViewToTop } from "@/lib/scroll-to-top";
import { nextT3EnableAction } from "@/lib/t3-progress";
import { track } from "@/lib/track";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Pencil, Loader2, TriangleAlert } from "lucide-react";
import {
  wakePod,
  sleepPod,
  destroyPod,
  renamePod,
  setPodPreviewPublic,
  setPodAutoUpdate,
  updatePodImage,
  podUpdateProgress,
  t3Progress,
  enableT3Code,
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
import T3Enabling from "@/components/t3-enabling";
import CodexPairingWizard from "@/components/codex-pairing-wizard";
import ProviderAuthWizard from "@/components/provider-auth-wizard";
import T3ConnectWizard from "@/components/t3-connect-wizard";
import { PasteCodeInput } from "@/components/paste-code-input";
import type { AuthStepKind, ProviderId } from "@/lib/provider-auth-steps";
import PodSuspended from "@/components/pod-suspended";
import { POD_TIERS, labelForPod, type PodSize } from "@podbay/shared/tiers";
import { TerminalClient } from "@/lib/terminal-client";
import ProvisionStages from "@/components/provision-stages";
import WizardProgress from "@/components/wizard-progress";
import SecretsPanel from "@/components/secrets-panel";
import GithubConnect from "@/components/github-connect";
import { RelayInfoDialog } from "@/components/relay-info-dialog";
import { RelayStatus } from "@/components/relay-status";
import type { MyRelayLive } from "@/lib/relay-actions";
import ConnectWalkthrough from "@/components/connect-walkthrough";
import ClaudeSettingsDialog from "@/components/claude-settings-dialog";
import { CopyCodeButton } from "@/components/copy-code-button";
import AgentCards from "@/components/agent-cards";
import PreviewCard from "@/components/preview-card";
import T3ConnectPanel from "@/components/t3-connect-panel";
import { SettingRow } from "@/components/setting-row";
import HealthStrip from "@/components/health-strip";
import HealthPanel from "@/components/health-panel";
import ActivityTab from "@/components/activity-tab";
import type { ActivityEvent } from "@/lib/pod-activity";
import LifecycleTimeline from "@/components/lifecycle-timeline";
import type { LifecycleInterval } from "@podbay/control-plane";
import { shortDigest, imageVersionLabel } from "@/lib/pod-image";
import { SESSION_INTERRUPT_WARNING } from "@/lib/pod-copy";
import {
  UpdateInfoDialog,
  UpdateBasicsDialog,
  updateHeadline,
  type UpdateInfo,
} from "@/components/update-info-dialog";
import { StatusDot, StatusBadge } from "@/components/pod-status";
import { deriveState, codexChipFor, type PodCardLive } from "@/lib/pod-visual-state";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  /** Release version of the image this pod is CURRENTLY running (release-versioning). Null for a
   * pre-versioning build or a build not cut as a release, in which case the digest shows alone. */
  currentVersion?: string | null;
  /** Self-host only: the version + summary of the pending update, from the public release manifest
   * (release-versioning §4). Null → no published release names the target, so show the digest line. */
  ossReleaseVersion?: string | null;
  ossReleaseSummary?: string | null;
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
  /** T3 Code control (durable): `t3Control` = T3 owns the agents right now (banner + hidden
   * controls); `t3Since` set while the enable/disable wizard runs (full-page flow), `t3StageInitial`
   * the phase — all refresh-safe, mirroring updatingSince/updateStage. */
  t3Control: boolean;
  /** t3Connected: the pod's t3 is signed into the owner's T3 account + this env linked (syncs to their
   * devices). Drives the post-enable "Connect to T3" wizard step + the Control-tab connected state. */
  t3Connected: boolean;
  t3Since: string | null;
  /** The pod's Claude auth mode — drives whether enabling T3 needs to mint the 1-year token first. */
  agentAuth: "subscription" | "api-key" | "setup-token" | null;
  t3StageInitial: string | null;
  status: string;
  size: PodSize;
  diskGb: number;
  lifecycle: string;
  lifecycleLocked: boolean;
  previewUrl: string | null;
  previewPublic: boolean;
  /** Fleet-updates (C): "off" = excluded from the bulk "update idle pods" button; "inherit" = included.
   * Cloud-only surface. */
  autoUpdate?: "inherit" | "off";
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
/** Cockpit tab ids, also the accepted values of ?tab= (anything else → settings). */
const COCKPIT_TABS = ["control", "settings", "secrets", "stats", "activity", "details", "admin"] as const;

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
    currentVersion,
    ossReleaseVersion,
    ossReleaseSummary,
    updateAvailable,
    newImageDigest = null,
    agent,
    podAgents = [],
    addableAgents = [],
    updateInfo,
    updatingSince,
    updateStageInitial,
    maintenanceKindInitial,
    t3Control,
    t3Connected,
    t3Since,
    agentAuth,
    t3StageInitial,
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
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();

  // Tab state in the URL, so refreshing on Stats doesn't drop you on Settings.
  // The tab is driven by LOCAL state and the URL is synced as a side effect —
  // deriving it straight from useSearchParams made every tab click wait on a
  // router transition, which queues behind any in-flight server action (a pod
  // update takes minutes), so the tabs appeared frozen. Local state switches
  // instantly; the URL catches up whenever the router is free.
  const initialTab = (COCKPIT_TABS as readonly string[]).includes(searchParams.get("tab") ?? "")
    ? (searchParams.get("tab") as string)
    : "control";
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
  // Latch the launch-into-T3 intent at mount. A pod created under T3 control arrives with ?enableT3=1,
  // but that one-shot flag is stripped the moment the enable fires (review #1) — so read it ONCE here.
  // It drives skipping the subscription-login onboarding step (see effPhase below): a T3 pod needs ONLY
  // the 1-year setup-token, minted as the SINGLE login by the auto-enable flow. (fix/t3-launch-single-login)
  const [t3Launch] = useState(() => searchParams.get("enableT3") === "1");
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
  const [autoUpdate, setAutoUpdateState] = useState<"inherit" | "off">(props.autoUpdate ?? "inherit");
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
  // T3 Code enable/disable wizard state — seeded durably from the row (t3Since), kept live by the
  // poll below (mirrors the update flow). `inControl` drives the banner + hiding conflicting controls.
  const [t3Enabling, setT3Enabling] = useState(Boolean(t3Since));
  // `connecting` bridges the enabling → connect handoff in ONE batched render so the cockpit never flashes
  // between them (a URL change alone doesn't batch with the enabling flag). It gates T3Enabling off and the
  // connect wizard on; the URL `?wiz=t3connect` set alongside keeps it refresh-safe.
  const [connecting, setConnecting] = useState(false);
  // Agent Control-tab full-page wizards (agent-control-wizards): user-initiated takeovers, gated like
  // update/T3 below. `pairingOpen` = Codex pairing; `signinWizard` = Claude sign-in/reconnect.
  // Agent wizards are backed by a `?wiz=` URL param, NOT ephemeral state — so a page refresh mid-sign-in
  // or mid-pairing lands you back in the wizard instead of vanishing (like update/T3, which survive via
  // durable state). `wiz` = "pair" | "signin:<agent>" | "reconnect:<agent>".
  const wiz = searchParams.get("wiz");
  const setWiz = (v: string | null) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (v) params.set("wiz", v);
    else params.delete("wiz");
    // `enableT3` is a ONE-SHOT launch flag (3.2). Drop it on any wiz change so a later reload can't
    // re-trigger the enable — a session-interrupting action — with no user intent (review #1).
    params.delete("enableT3");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const pairingOpen = wiz === "pair";
  const signinWizard = wiz?.startsWith("signin:")
    ? { agentId: wiz.slice("signin:".length), mode: "signin" as const }
    : wiz?.startsWith("reconnect:")
      ? { agentId: wiz.slice("reconnect:".length), mode: "reconnect" as const }
      : null;
  const openPairing = () => {
    setWiz("pair");
  };
  const closePairing = () => {
    setWiz(null);
  };
  const [t3Stage, setT3Stage] = useState<string | null>(t3StageInitial);
  const [t3InControl, setT3InControl] = useState(t3Control);
  const [t3StartedAt, setT3StartedAt] = useState<number | null>(t3Since ? Date.parse(t3Since) : null);
  // Start the T3 enable + show its progress screen. Flip `t3Enabling` (which starts the t3Progress poll)
  // only AFTER enableT3Code resolves — startT3Enable writes t3Since before returning, so this stops the
  // poll from reading the row too early, seeing active:false, and bouncing out of the screen (review #2).
  // A synchronous failure is surfaced instead of swallowed (review #3).
  const runT3EnableAndShow = () => {
    setT3Stage("preparing");
    setT3StartedAt(Date.now());
    // Show the progress screen IMMEDIATELY (no cockpit flash while enableT3Code is in flight). The poll's
    // grace window (below) keeps it from bouncing before t3Since is written. On a sync failure, clear it.
    setT3Enabling(true);
    void enableT3Code(slug).then((r) => {
      if (r && "error" in r) {
        setT3Enabling(false);
        setActionError(`Couldn't enable T3 Code: ${r.error}`);
      }
    });
  };
  // The enable decision (2.2), shared by the cockpit button (onEnable) and the launch-into-T3 auto-start
  // (3.2): already on the 1-year token → enable directly; otherwise mint it first via the OAuth wizard.
  const beginT3Enable = () => {
    if (agentAuth === "setup-token") runT3EnableAndShow();
    else setWiz("renew-then-t3");
  };
  const autoEnabledT3 = useRef(false);
  // Live agent signals for THIS pod — the SAME feed (and cache: qk.liveSignals) the dashboard cards
  // use, so the page shows the SAME activity state (Working / Idle / Waiting) and matching colours
  // instead of a bare "Running". react-query: cached (navigating pod→cockpit paints instantly),
  // polled 10s, paused while the tab is hidden.
  const { data: live = null, isSuccess: liveLoaded } = useQuery({
    queryKey: qk.liveSignals(),
    enabled: status === "running",
    refetchInterval: 10_000,
    // The owner feed returns every pod; narrow to THIS one in a select so the header re-renders only
    // when its own signals change.
    select: (rows): PodCardLive | null => {
      const r = rows.find((x) => x.id === slug);
      return r
        ? {
            status: r.status,
            updating: r.updating,
            agentStatus: r.agentStatus,
            codexStatus: r.codexStatus,
            agentWaitingFor: r.agentWaitingFor,
            agentIdleMs: r.agentIdleMs,
            agents: r.agents,
            appListening: r.appListening,
            criticalIssue: r.criticalIssue,
            unreachable: r.unreachable,
          }
        : null;
    },
    queryFn: () => apiGet<PodLiveSignals[]>("/api/pods/live-signals"),
  });
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

  // A T3 pod must NOT sit on the subscription /login onboarding step — that is the wrong login (a T3 pod
  // is driven on the 1-year setup-token). Treat "login" as "ready" so the setup-token wizard / enabling
  // screen takes over instead. Key this on the DURABLE T3 signals — the URL-backed wizard (?wiz), the
  // enabling state (t3Since), in-control (t3_control) — plus the legacy launch latch, so it SURVIVES A
  // REFRESH (the old transient-flag version fell back to "Sign in to Claude" on reload). Codex keeps its
  // own device login (setup-token is Claude-only). (fix/t3-launch-single-login, hardened in fix/t3-wizard-polish)
  const inT3Flow =
    t3Launch ||
    wiz === "renew-then-t3" ||
    wiz === "renew-token" ||
    t3Enabling ||
    t3InControl ||
    // Once the 1-year token is minted, this IS a T3 pod until it's in control — so even if the enable
    // step is between states or failed (t3Since cleared), never fall back to the subscription /login.
    (agentAuth === "setup-token" && !t3InControl);
  const effPhase: SetupStep = inT3Flow && !isCodex && phase === "login" ? "ready" : phase;
  const onboarding = effPhase !== "ready";
  // Launch-into-T3 (3.2): a pod created under T3 control arrives here with ?enableT3=1; once it reaches
  // READY, auto-start the same OAuth-then-enable flow the cockpit button uses. Ref-guarded to fire once.
  useEffect(() => {
    if (autoEnabledT3.current || searchParams.get("enableT3") !== "1") return;
    if (onboarding || t3InControl || t3Enabling) return;
    autoEnabledT3.current = true;
    // Strip the one-shot flag now (review #1) — the setup-token direct-enable branch never hits setWiz,
    // so it wouldn't be cleared otherwise; the subscription branch's setWiz clears it too (idempotent).
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete("enableT3");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    beginT3Enable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding, t3InControl, t3Enabling]);
  // Robust auto-enable after the 1-year token is minted. The sign-in wizard's onDone hand-off can
  // silently drop (observed on t3test: agentAuth got patched to setup-token, but enableT3Code never
  // reached the server — the wizard's onComplete→onDone→runT3EnableAndShow chain didn't fire). Once
  // agentAuth === "setup-token" this pod IS bound for T3 (that token is inference-only, useless under
  // Podbay control), so start the enable HERE — the one reliable trigger for launch, the cockpit
  // button, AND a pod left stranded. THAT double-enabled: completeSetupToken (server) already fires the
  // enable, so the client must only SHOW it, not re-trigger. When the durable t3Since says an enable is in
  // progress and we're not in control yet, show the progress screen — which also makes the wizard →
  // enabling transition flash-free.
  useEffect(() => {
    if (t3Since && !t3InControl && !t3Enabling && !onboarding) {
      setT3StartedAt((s) => s ?? Date.parse(t3Since));
      setT3Enabling(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t3Since, t3InControl, t3Enabling, onboarding]);
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
  // Shared visual state (same module the dashboard card uses) so page and card agree.
  const cockpitAgents = podAgents.length ? podAgents : [agent];
  const hasClaudeAgent = cockpitAgents.includes("claude-code") || cockpitAgents.length === 0;
  // Pass T3 state so the cockpit header matches the dashboard card — while T3 owns the pod its Claude
  // agent reads as not-signed-in (RC yielded), which would otherwise show "Needs you" in the header
  // even though T3 is driving it fine (t3ttt, 2026-08-25).
  const podState = deriveState(status, updating, live, hasClaudeAgent, { control: t3InControl, enabling: t3Enabling });
  const cockpitCodexChip = codexChipFor({
    reachable: status === "running" && !onboarding,
    onboarding,
    hasClaude: hasClaudeAgent,
    agents: cockpitAgents,
    codexStatus: live?.codexStatus ?? null,
  });
  const activityChip = podState.chip
    ? { label: podState.chip.label, className: podState.chip.className, dot: podState.chip.dot, pulse: podState.chip.pulse }
    : cockpitCodexChip
      ? {
          label: cockpitCodexChip.label,
          className: cockpitCodexChip.className,
          dot: cockpitCodexChip.label === "Working" ? "bg-success" : "bg-muted-foreground/70",
          pulse: cockpitCodexChip.label === "Working",
        }
      : null;
  // Running but the first live poll hasn't returned yet → a neutral loading indicator (not the
  // lifecycle "Running", which would then flip to Idle). Once loaded with no activity chip, we fall
  // through to the lifecycle badge.
  const activityLoading =
    status === "running" && !onboarding && !updating && !liveLoaded && !activityChip;

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
  // Poll the event-derived progress while updating (react-query: gated by `enabled`, bounded retry so
  // a failed poll doesn't strand the "Updating…" UI). The side effects (advance stage, finish) run in
  // an effect that reacts to the freshest poll result.
  const { data: updateProg } = useQuery({
    queryKey: qk.updateProgress(slug),
    enabled: updating,
    refetchInterval: 3000,
    queryFn: () => podUpdateProgress(slug),
  });
  useEffect(() => {
    if (!updating || !updateProg) return;
    setUpdateStage(updateProg.stage);
    if (updateProg.startedAt) setUpdateStartedAt(Date.parse(updateProg.startedAt));
    if (!updateProg.active) {
      setUpdating(false);
      if (updateProg.error) setActionError(`Couldn't update: ${updateProg.error}`);
      else router.refresh();
    }
  }, [updateProg, updating, router]);
  useEffect(() => {
    if (!updating) return;
    const secs = setInterval(() => forceTick((n) => n + 1), 1000); // elapsed counter
    return () => clearInterval(secs);
  }, [updating]);

  // T3 Code enable/disable progress — same shape as the update poll. The enable/disable actions
  // return immediately; the durable t3Since/t3Stage drive the full-page wizard, and when it clears
  // we flip back to the cockpit (router.refresh picks up the new t3Control).
  const t3Elapsed = t3StartedAt ? Math.round((Date.now() - t3StartedAt) / 1000) : 0;
  const { data: t3Prog } = useQuery({
    queryKey: qk.t3Progress(slug),
    enabled: t3Enabling,
    refetchInterval: 3000,
    queryFn: () => t3Progress(slug),
  });
  useEffect(() => {
    if (!t3Enabling || !t3Prog) return;
    setT3Stage(t3Prog.stage);
    setT3InControl(t3Prog.inControl);
    if (t3Prog.startedAt) setT3StartedAt(Date.parse(t3Prog.startedAt));
    // The completion decision lives in a pure, exhaustively-tested function (lib/t3-progress) — the
    // inline version here conflated "finished" with "not started yet" (both have startedAt=null) and
    // froze the wizard on "Preparing" when an enable actually completed (t3ttt, 2026-08-25).
    switch (nextT3EnableAction(t3Prog, { t3Connected, connecting })) {
      case "wait":
        return;
      case "error":
        setT3Enabling(false);
        setActionError("T3 Code setup failed — please try again.");
        return;
      case "connect":
        // Enable done → guide the owner straight into connecting their T3 account (the wizard, not the
        // control page). Keep t3Enabling set; `connecting` gates T3Enabling off + the connect wizard on
        // in ONE render (no cockpit flash), and ?wiz keeps it refresh-safe.
        setConnecting(true);
        setWiz("t3connect");
        return;
      case "done":
        setT3Enabling(false);
        router.refresh();
        return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t3Prog, t3Enabling, router, t3Connected, connecting, t3StartedAt]);
  useEffect(() => {
    if (!t3Enabling) return;
    const secs = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(secs);
  }, [t3Enabling]);

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
  /** Enable a supported agent that isn't on the pod yet — the Control tab's "Enable {agent}" row.
   * Same confirm + add flow the old "Add an agent" block used. */
  const enableAgent = (a: string) =>
    setConfirm({
      title: `Add ${agentLabel(a)} to this pod?`,
      message: (
        <>
          It starts in its own terminal tab, alongside {agentLabel(agent)} — which keeps running,
          uninterrupted.
        </>
      ),
      warning: (
        <>
          Both agents share this pod&rsquo;s <strong>workspace</strong> and preview port. Switch between
          them rather than running both at once on the same files.
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
    });

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

  /**
   * Which full-page takeover is replacing the cockpit right now (null = none). Mirrors the
   * early-return chain below IN ORDER, so the value names the view that actually renders.
   *
   * A takeover swaps the whole view, but the browser keeps the SCROLL OFFSET of the page you were
   * on. Pressing Update — or opening any wizard — from a control far down a long mobile cockpit
   * therefore dropped you into the middle or bottom of the new flow instead of its first line
   * (owner report, 2026-08-27). Deriving one key here (rather than adding a scroll to each of the
   * six takeover components) means a future takeover added to the chain is covered by default.
   */
  const takeover = onboarding
    ? null
    : updating
      ? "updating"
      : t3Enabling && !connecting
        ? "t3-enabling"
        : pairingOpen
          ? "pairing"
          : signinWizard
            ? `signin:${signinWizard.agentId}:${signinWizard.mode}`
            : wiz === "t3connect" || connecting
              ? "t3-connect"
              : wiz === "renew-token" || wiz === "renew-then-t3"
                ? "renew"
                : null;
  useEffect(() => {
    // scrollViewToTop, NOT window.scrollTo: the dashboard shell scrolls its <main>, so the window's
    // own scrollY is always 0 here and scrolling the window would be a silent no-op.
    if (takeover) scrollViewToTop(tabsRef.current);
  }, [takeover]);

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
      />
    );
  }
  // Enabling/turning off T3 Code replaces the cockpit with its own full-page flow, same as an update.
  // `!connecting` hands straight to the connect wizard below without a cockpit frame in between.
  if (t3Enabling && !connecting && !onboarding) {
    return (
      <T3Enabling
        name={name}
        slug={slug}
        environmentName={environmentName}
        agentsLabel={agentsLabel}
        stage={t3Stage}
        elapsedSec={t3Elapsed}
      />
    );
  }
  // Codex pairing / Claude sign-in take over the cockpit the same way (user-initiated from the Control
  // tab). They return to the cockpit on close, or — for sign-in — automatically once the agent auths.
  if (pairingOpen && !onboarding) {
    return (
      <CodexPairingWizard
        slug={slug}
        name={name}
        onClose={closePairing}
        onPaired={() => {
          void queryClient.invalidateQueries({ queryKey: qk.codexDevices(slug) });
          closePairing();
        }}
      />
    );
  }
  if (signinWizard && !onboarding) {
    const kind: AuthStepKind = signinWizard.agentId === "codex" ? "codex-device" : "claude-subscription";
    return (
      <ProviderAuthWizard
        slug={slug}
        name={name}
        environmentName={environmentName}
        steps={[{ provider: signinWizard.agentId as ProviderId, kind }]}
        stepIndex={0}
        onStepIndex={() => {}}
        onDone={() => setWiz(null)}
        onCancel={() => setWiz(null)}
        reconnect={signinWizard.mode === "reconnect"}
      />
    );
  }
  if ((wiz === "t3connect" || connecting) && !onboarding) {
    // Post-enable (via `connecting`, no flash) or a re-entry from the Control tab (via ?wiz): sign into the
    // T3 account + link the env so it syncs to the owner's devices. Full-page — not the control page.
    const leaveConnect = () => {
      setConnecting(false);
      setT3Enabling(false);
      setWiz(null);
    };
    return (
      <T3ConnectWizard
        slug={slug}
        name={name}
        environmentName={environmentName}
        onClose={leaveConnect}
        onComplete={() => {
          leaveConnect();
          router.refresh();
        }}
      />
    );
  }
  if ((wiz === "renew-token" || wiz === "renew-then-t3") && !onboarding) {
    // "renew-then-t3" (2.2): the owner asked to enable T3 on a pod that isn't yet on the 1-year token —
    // mint it here, THEN kick off the T3 enable (which now launches t3 serve on the token, task 2.1).
    return (
      <ProviderAuthWizard
        slug={slug}
        name={name}
        environmentName={environmentName}
        steps={[{ provider: "claude-code", kind: "claude-setup-token" }]}
        stepIndex={0}
        onStepIndex={() => {}}
        onDone={() => {
          // renew-then-t3 = launch/enable: completeSetupToken (server) already auto-started the enable, so
          // show its progress screen NOW (no cockpit flash between the wizard and enabling). renew-token =
          // a plain expired-token renewal on an in-control pod — just close.
          if (wiz === "renew-then-t3") {
            setT3Stage("preparing");
            setT3StartedAt(Date.now());
            setT3Enabling(true);
          }
          setWiz(null);
        }}
        onCancel={() => setWiz(null)}
      />
    );
  }
  // The confirm modal is SHARED: it must render in the suspended branch (its Resume calls
  // setConfirm) AND the main cockpit. It used to live only in the main return, so on a suspended
  // pod setConfirm set state with no dialog in the tree to show it — Resume looked dead.
  const confirmDialog = (
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
  );

  if (status === "suspended") {
    return (
      <>
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
      {confirmDialog}
      </>
    );
  }

  return (
    // min-w-0 + overflow-x-clip: the PAGE must never scroll horizontally on mobile (owner req
    // 2026-08-24). Any child wider than the viewport (a long URL/token, a wide row) is contained here
    // rather than widening the page; internal scrollers (the tab strip) keep their own overflow-x-auto.
    // overflow-x-clip (not hidden) clips without creating a scroll container or promoting overflow-y.
    <div className="flex min-w-0 max-w-full flex-col gap-5 overflow-x-clip">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {activityChip ? (
            <span
              aria-hidden
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                activityChip.dot,
                activityChip.pulse && "animate-pulse",
              )}
            />
          ) : activityLoading ? (
            <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/40" />
          ) : (
            <StatusDot status={updating ? transientKind : status} />
          )}
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
          {activityChip ? (
            <span
              data-testid="pod-status"
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
                activityChip.className,
              )}
            >
              {activityChip.pulse && (
                <span className={cn("size-1.5 animate-pulse rounded-full", activityChip.dot)} aria-hidden />
              )}
              {activityChip.label}
            </span>
          ) : activityLoading ? (
            // First live poll hasn't returned — a neutral pulsing skeleton (matches the dashboard
            // card), never the lifecycle word "Running" which would then flip to Idle/Working.
            <span
              data-testid="pod-status"
              aria-hidden
              className="inline-flex h-[19px] w-14 animate-pulse items-center rounded-md border border-border bg-white/[0.04]"
            />
          ) : (
            <StatusBadge status={updating ? transientKind : status} />
          )}
          <span className="ml-1">{environmentName}</span>
          {/* The AGENT's real activity (session mtime) — counts remote-control + autonomous work;
              lastActiveAt only sees terminal traffic and goes stale. Falls back until the first poll. */}
          <span>
            · active{" "}
            {live?.agentIdleMs != null
              ? ago(new Date(Date.now() - live.agentIdleMs).toISOString())
              : ago(lastActiveAt)}
          </span>
        </div>
      </header>

      {/* Onboarding hero — the only prominent CTA until ready */}
      {onboarding && (
        <div className="flex flex-col gap-1.5">
          <WizardProgress current={phase} />

          {/* Wizard-level cancel. The pod is already a real machine (past the green "Create" step), so
              there's no clean "back to Configure" — the honest version is to DELETE it and return to
              configure a new one (owner ask 2026-08-24). To just step away and let it keep setting up,
              the page's own "← Dashboard" nav does that non-destructively. */}
          <button
            type="button"
            data-testid="onboarding-cancel"
            disabled={removing}
            onClick={() =>
              setConfirm({
                title: "Cancel setup?",
                message: (
                  <>
                    This deletes this pod and its machine, and returns you to your pods. It can&rsquo;t be
                    undone. To step away and let it keep setting up instead, use <strong>← Dashboard</strong>.
                  </>
                ),
                confirmLabel: "Cancel setup",
                danger: true,
                run: () => {
                  setRemoving(true);
                  setActionError(null);
                  start(async () => {
                    const r = await destroyPod(slug);
                    if (r?.error) {
                      setRemoving(false);
                      setActionError(`Couldn't cancel setup: ${r.error}`);
                    } else {
                      router.push("/dashboard");
                    }
                  });
                },
              })
            }
            className="mb-1 inline-flex w-fit items-center text-[12.5px] text-muted-foreground/70 hover:text-destructive disabled:opacity-60"
          >
            {removing ? "Cancelling…" : "Cancel setup"}
          </button>

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
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm text-muted-foreground">Paste the code Claude gives you</p>
                  <PasteCodeInput
                    value={authCode}
                    onChange={setAuthCode}
                    onSubmit={submitCode}
                    submitting={authSubmitting}
                    submitted={codeSent}
                  />
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
        <TabsList variant="line" className="mb-4 max-w-full justify-start gap-5 overflow-x-auto overflow-y-clip overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="control" className="flex-none px-0" data-tour="tab-control">Control</TabsTrigger>
          <TabsTrigger value="settings" className="flex-none px-0" data-tour="tab-settings">Settings</TabsTrigger>
          <TabsTrigger value="secrets" className="flex-none px-0" data-tour="tab-secrets">Secrets</TabsTrigger>
          <TabsTrigger value="stats" className="flex-none px-0" data-tour="tab-stats">Stats</TabsTrigger>
          <TabsTrigger value="activity" className="flex-none px-0" data-tour="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="details" className="flex-none px-0" data-tour="tab-details">Details</TabsTrigger>
          <TabsTrigger value="admin" className="flex-none px-0" data-tour="tab-admin">Admin</TabsTrigger>
        </TabsList>

        {/* Control — the agents (Claude/Codex) + T3 Code control, the primary thing you
            do with a pod, so it's the first tab and the default. */}
        <TabsContent value="control" className="min-h-[20rem]">
          {/* ONE card of rows (like Settings): Claude + Codex always shown (an Enable row when not on
              the pod), then T3 Code control. Divider rows come from each row's `border-t first:border-t-0`. */}
          <Card className="gap-1 py-4">
            <CardContent className="py-0">
              <AgentCards
                slug={slug}
                podName={props.name}
                status={status}
                primaryAgent={agent}
                agentsOnPod={agentsOnPod}
                addableAgents={status === "running" ? addableAgents : []}
                onEnable={enableAgent}
                enabling={addingAgent}
                sessionUrl={sessionUrl}
                authedAt={props.authedAt}
                updateAvailable={updateAvailable}
                onConfirm={setConfirm}
                externalControl={t3InControl}
                onPairCodex={openPairing}
                onSignin={(agentId, mode) => setWiz(`${mode}:${agentId}`)}
                agentAuth={agentAuth}
                onRenewToken={() => setWiz("renew-token")}
              />
              <T3ConnectPanel
                slug={slug}
                podName={name}
                inControl={t3InControl}
                connected={t3Connected}
                onConnect={() => setWiz("t3connect")}
                onEnable={beginT3Enable}
                onEnableStarted={() => {
                  setT3Stage("preparing");
                  setT3StartedAt(Date.now());
                  setT3Enabling(true);
                }}
                onDisableStarted={() => {
                  setT3Stage("stopping");
                  setT3StartedAt(Date.now());
                  setT3Enabling(true);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="min-h-[20rem] space-y-4">
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
                  ? ossReleaseVersion
                    ? // Self-host WITH a published release for the target: name the version + what's new.
                      `Update available · v${ossReleaseVersion.replace(/^v/i, "")}${
                        newImageDigest ? ` (${shortDigest(newImageDigest)})` : ""
                      } — ${ossReleaseSummary?.trim() || "your files, plan and sign-in are kept"}`
                    : // No published release names the target — the honest fallback is the from→to digests.
                      `New pod-base available · ${imageDigest ? shortDigest(imageDigest) : "?"} → ${
                        newImageDigest ? shortDigest(newImageDigest) : "latest"
                      } — your files, plan and sign-in are kept`
                  : [
                      updateHeadline(updateInfo?.target?.summary, updateInfo?.target?.notes),
                      "your files, plan and sign-in are kept",
                    ].join(" — ")
                : imageDigest
                  ? `Up to date · ${imageVersionLabel(currentVersion, imageDigest)}`
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
                : `${POD_TIERS[size].label}: ${POD_TIERS[size].cpus} vCPU · ${POD_TIERS[size].memoryGb} GB RAM · ${Math.max(diskGb, POD_TIERS[size].diskGb)} GB disk`
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

          {/* Fleet-updates (C): exclude a pod from the bulk "update idle pods" button. Cloud-only —
              self-host updates are a host-level compose pull, not a per-pod action. A pod running a
              service (always-on) is the shape you'd exclude, so it restarts only when YOU choose. */}
          {!oss && (
            <SettingRow
              label="Auto-update"
              desc={
                autoUpdate === "off"
                  ? "Off — skipped by “Update idle pods”; update it here when you choose"
                  : "On — included in the “Update idle pods” bulk action when idle"
              }
            >
              <Switch
                checked={autoUpdate !== "off"}
                disabled={pending || updating}
                aria-label="Auto-update"
                onCheckedChange={(on) => {
                  const next = on ? "inherit" : "off";
                  setAutoUpdateState(next);
                  act(() => setPodAutoUpdate(slug, on), "update auto-update");
                }}
              />
            </SettingRow>
          )}

          {/* Config now syncs AUTOMATICALLY: the reconcile sweep detects when this running pod has
              drifted from the env's current .claude/skills/settings layer and re-applies it in place,
              no button and no restart (control-plane reconcileConfigDrift). So there is no manual
              "Sync config" control here anymore. */}

          {/* Claude Code's own settings (attribution, unattended timeouts, auto-compact) — only
              when Claude runs here and the pod is up (the editor reads/writes ~/.claude in the pod). */}
          {hasClaudeAgent && status === "running" && (
            <SettingRow
              label="Claude settings"
              desc="Attribution, unattended timeouts, auto-compact"
            >
              <ClaudeSettingsDialog slug={slug} />
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


      {confirmDialog}

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
