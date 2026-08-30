"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { track } from "@/lib/track";
import { scrollViewToTop } from "@/lib/scroll-to-top";
import { useRouter } from "next/navigation";
import { launchPod } from "@/lib/actions";
import WizardProgress from "@/components/wizard-progress";
import { AgentLogo } from "@/components/agent-logo";
import ProvisionStages from "@/components/provision-stages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Label } from "@/components/ui/label";
import SizePicker from "@/components/size-picker";
import HostResourceChooser, { type HostCapacity } from "@/components/host-resource-chooser";
import { slotsForSize } from "@podbay/shared/tiers";
import { openSupportChat } from "@/lib/support-chat";
import { GithubRepoField } from "@/components/github-repo-field";
import { DEFAULT_POD_SIZE, POD_TIERS, type PodSize } from "@podbay/shared/tiers";
import type { DeclaredSecret } from "@/lib/environments";
import type { EnvPair } from "@/lib/env-paste";

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

// SHELVED: api-key auth mode works headless but the interactive TUI won't run cleanly on
// a key (it refuses inference — "Not logged in") and Remote Control is subscription-only,
// so an api-key pod is broken/degraded. The whole plumbing stays (schema→boot→greeter);
// only the launch UI is hidden until the TUI-on-key path is fixed. Flip to re-enable.
const SHOW_API_KEY_MODE = false;

/**
 * The pre-create launch wizard: one choice per screen (Basics → GitHub → Settings →
 * Review), showing only the steps this environment needs. On the Review step, Create
 * runs the launch action and hands off to the pod's durable setup page — the
 * post-create phases (creating → login → agent → ready) are DB-derived there and
 * untouched by this file. Pods run 24/7 (2026-07-20 sleep-kill pivot) — no lifecycle
 * choice; suspend is an explicit verb on the running pod.
 *
 * The whole draft (step + fields) is mirrored to sessionStorage so a refresh mid-config
 * resumes exactly where the user was, and cleared once a pod is created.
 */

const AGENT_LABELS: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

type LaunchStep = "basics" | "github" | "agents" | "secrets" | "review";
const STEP_LABELS: Record<LaunchStep, string> = {
  basics: "Basics",
  github: "GitHub",
  agents: "Agents",
  secrets: "Secrets",
  review: "Review",
};

type Draft = {
  step: LaunchStep;
  name: string;
  size: PodSize;
  /** Self-host explicit sizing (self-host-pod-sizing): CPU cores + memory (MB), null ⇒ unlimited. */
  cpus: number | null;
  memoryMb: number | null;
  values: Record<string, string>;
  /** Extra keys added by pasting a .env (beyond the env's declared secrets). */
  extraKeys: string[];
  githubRepo: string | null;
  agent: string;
  providers: string[];
  control: "podbay" | "t3";
  /** Persist the auth-mode choice, never the key value (a plaintext key must not sit
   * in sessionStorage). */
  agentAuth: "subscription" | "api-key";
};

export default function LaunchConfigure({
  t3Enabled = true,
  env,
  secrets,
  byoRepo = false,
  agentIds = [],
  enabled,
  initialStep,
  slots,
  oss = false,
  capacity = null,
}: {
  env: string;
  secrets: DeclaredSecret[];
  byoRepo?: boolean;
  /** Agent CLI ids the env declares (multi-agent-plan.md slice 3). The picker shows
   * only when the env offers more than one; a single-agent env stays chromeless. */
  agentIds?: string[];
  enabled: boolean;
  /** Optional starting step from `?step=` — a bookmark/share lands right; the
   * sessionStorage draft (if any) still wins so a reload resumes exactly. */
  initialStep?: string;
  /** The account's slot budget, so a launch that won't fit is blocked here rather than
   * failing on submit. `unlimited` (admins) skips the gate. */
  slots: { used: number; cap: number; unlimited: boolean };
  /** Self-host (self-host-pod-sizing): swap the cloud tier cards for a real-host resource
   * chooser. `capacity` is the Docker host's CPU/RAM + what running pods reserved (null if
   * docker was unreachable). Both default off ⇒ cloud tier picker, unchanged. */
  oss?: boolean;
  /** Whether the T3 Code harness is enabled (agent-harness-toggle). When false, the Control picker
   * is hidden, control is pinned to "podbay", and no t3 draft can restore. */
  t3Enabled?: boolean;
  capacity?: HostCapacity | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [size, setSize] = useState<PodSize>(DEFAULT_POD_SIZE);
  // Self-host resource limits (self-host-pod-sizing); null ⇒ unlimited, the OSS default.
  const [cpus, setCpus] = useState<number | null>(null);
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [agent, setAgent] = useState<string>(agentIds[0] ?? "claude-code");
  // The pod's providers (agent CLIs) — multi-select, ≥1 (t3-unattended-integration 3.1). Defaults to the
  // env's first agent so a single-agent env is unchanged. `control` picks Podbay vs T3 (unattended).
  const offered = agentIds.length ? agentIds : ["claude-code"];
  const [providers, setProviders] = useState<string[]>([offered[0]]);
  const [control, setControl] = useState<"podbay" | "t3">("podbay");
  // Auth mode is a per-pod compliance choice (api-key-pod-mode.md): subscription
  // (default) or a BYO API key for unattended/automated pods.
  const [agentAuth, setAgentAuth] = useState<"subscription" | "api-key">("subscription");
  const [agentApiKey, setAgentApiKey] = useState("");
  const toggleProvider = (id: string) =>
    setProviders((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  // Every env offers every agent, so the Agents step (agent multi-select + control) ALWAYS shows.
  // Secrets get their OWN step — one decision per screen — present only when the env declares any.
  const hasSecrets = secrets.length > 0;
  const steps: LaunchStep[] = [
    "basics",
    ...(byoRepo ? (["github"] as const) : []),
    "agents",
    ...(hasSecrets ? (["secrets"] as const) : []),
    "review",
  ];

  const DRAFT_KEY = `podbay:launch-draft:${env}`;
  const [step, setStep] = useState<LaunchStep>("basics");
  // Each step swaps the panel's content but the view keeps its SCROLL OFFSET, so advancing from a
  // Next button at the bottom of a long step (exactly where a phone user is when they tap it)
  // opened the next one already scrolled past its heading. Same class of bug as the cockpit's
  // full-page takeovers (owner report, 2026-08-27). scrollViewToTop — not window.scrollTo — because
  // the dashboard shell scrolls its <main>, so the window never moves here. Skips the initial mount
  // so a restored draft doesn't yank a deliberately-positioned page.
  const steppedOnce = useRef(false);
  useEffect(() => {
    if (!steppedOnce.current) {
      steppedOnce.current = true;
      return;
    }
    scrollViewToTop();
  }, [step]);
  // Restore the draft once, on mount. Done in an effect (not a lazy initializer) so
  // server and first client render agree — sessionStorage doesn't exist on the server.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let draft: Partial<Draft> | null = null;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) draft = JSON.parse(raw) as Partial<Draft>;
    } catch {
      /* corrupt/absent draft — start clean */
    }
    if (draft) {
      if (typeof draft.name === "string") setName(draft.name);
      if (draft.size) setSize(draft.size);
      if (typeof draft.cpus === "number" || draft.cpus === null) setCpus(draft.cpus ?? null);
      if (typeof draft.memoryMb === "number" || draft.memoryMb === null)
        setMemoryMb(draft.memoryMb ?? null);
      if (draft.values) setValues(draft.values);
      if (Array.isArray(draft.extraKeys)) setExtraKeys(draft.extraKeys);
      if (typeof draft.githubRepo === "string" || draft.githubRepo === null)
        setGithubRepo(draft.githubRepo ?? null);
      if (draft.agent) setAgent(draft.agent);
      if (Array.isArray(draft.providers) && draft.providers.length) setProviders(draft.providers.filter((p) => offered.includes(p)));
      if (draft.control === "podbay" || (draft.control === "t3" && t3Enabled)) setControl(draft.control);
      if (draft.agentAuth) setAgentAuth(draft.agentAuth);
    }
    // Initial step: the saved draft wins (true resume), else the ?step= hint, else first.
    const wanted = (draft?.step ?? initialStep) as LaunchStep | undefined;
    setStep(wanted && steps.includes(wanted) ? wanted : steps[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft on every change — but only after the initial restore, so we never
  // clobber a saved draft with the default state during the first render.
  useEffect(() => {
    if (!restored.current) return;
    try {
      const draft: Draft = { step, name, size, cpus, memoryMb, values, extraKeys, githubRepo, agent, providers, control, agentAuth };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage full/blocked — durability is best-effort */
    }
  }, [DRAFT_KEY, step, name, size, cpus, memoryMb, values, extraKeys, githubRepo, agent, providers, control, agentAuth]);

  // Pasting a `.env` blob into any secret field fills the declared keys and turns any
  // unknown valid keys into extra variables (rendered below, sent with launch).
  const applyPaste = (pairs: EnvPair[]) => {
    const valid = pairs.filter((p) => KEY_RE.test(p.key));
    if (valid.length === 0) return;
    setValues((vals) => {
      const next = { ...vals };
      for (const { key, value } of valid) next[key] = value;
      return next;
    });
    setExtraKeys((keys) => {
      const declared = new Set(secrets.map((s) => s.key));
      const add = valid
        .map((p) => p.key)
        .filter((k) => !declared.has(k) && !keys.includes(k));
      return add.length ? [...keys, ...add] : keys;
    });
  };

  const requiredFilled = secrets
    .filter((s) => s.required)
    .every((s) => (values[s.key] ?? "").trim().length > 0);
  // A BYO env IS the user's repo — launching without one leaves ~/work empty and
  // the kickoff ("orient in their codebase") with nothing to orient in. Required.
  // Self-host clones the repo AFTER the pod boots (the in-pod `gh` device login can't run until the
  // pod exists), so a BYO env never blocks launch on a repo in OSS — the user connects GitHub +
  // picks a repo from the pod's Settings once it's up.
  const repoPicked = !byoRepo || Boolean(githubRepo) || oss;
  // A name is required — it's how the pod (and the session in the user's Claude app) is
  // identified; an unnamed pod reads as a mistake in the list.
  const nameFilled = name.trim().length > 0;
  // Slot budget: the chosen size must fit the account's free slots (admins skip this).
  const slotCost = slotsForSize(size);
  const slotsFree = slots.cap - slots.used;
  const slotsFit = slots.unlimited || slotCost <= slotsFree;
  // api-key mode needs a key before launch (there's no /login to fall back on).
  const keyProvided = agentAuth !== "api-key" || agentApiKey.trim().length > 0;
  const launchable = nameFilled && requiredFilled && repoPicked && enabled && slotsFit && keyProvided;

  const idx = steps.indexOf(step);
  const isFirst = idx <= 0;
  const isLast = idx >= steps.length - 1;

  // Can we leave the CURRENT step? Only the step's own requirement gates forward motion;
  // Back never validates.
  const canAdvance =
    step === "basics"
      ? nameFilled
      : step === "github"
        ? repoPicked
        : step === "secrets"
          ? requiredFilled
          : true;

  function goto(next: LaunchStep) {
    setStep(next);
    // Mirror the step to the URL so a refresh/share lands on the same screen — but WITHOUT
    // a server round-trip. `router.replace` here triggers a full RSC refetch of this route
    // on every step, which is both wasteful and racy: dispatching the launch server action
    // while a step-replace navigation is still in flight wedges the action so it never
    // POSTs at all (the pod is never created; the wizard sits on "Creating…" forever). It's
    // reliably hit by the e2e (Next→Next→Create in milliseconds) and latent for fast users.
    // history.replaceState updates the URL with no navigation; `?step=` is read on mount and
    // the sessionStorage draft already restores the field values.
    window.history.replaceState(null, "", `/dashboard/pods/new?env=${encodeURIComponent(env)}&step=${next}`);
  }
  const next = () => !isLast && canAdvance && goto(steps[idx + 1]);
  const back = () => !isFirst && goto(steps[idx - 1]);

  function submit() {
    setError(null);
    track("pod_launch_submitted", {
      environment: env,
      agent,
      size,
      has_custom_name: Boolean(name.trim()),
      has_github_repo: Boolean(githubRepo),
      secret_count: secrets.length,
    });
    start(async () => {
      const cleaned: Record<string, string> = {};
      for (const key of [...secrets.map((s) => s.key), ...extraKeys]) {
        const v = (values[key] ?? "").trim();
        if (v) cleaned[key] = v;
      }
      const r = await launchPod(env, {
        name: name.trim() || undefined,
        secrets: Object.keys(cleaned).length ? cleaned : undefined,
        // Every pod runs 24/7 now; always-on derives keepAwake so nothing ever
        // idle-sleeps it, regardless of provider (docs/strategy/infra-strategy.md).
        lifecycle: "always-on",
        size,
        // Self-host: send the explicit limits (null ⇒ omit ⇒ unlimited). Cloud ignores them.
        cpus: oss ? cpus ?? undefined : undefined,
        memoryMb: oss ? memoryMb ?? undefined : undefined,
        githubRepo: githubRepo ?? undefined,
        // The owner's explicit provider pick (≥1) + control mode (Podbay or T3 unattended).
        agents: providers.length ? providers : undefined,
        control,
        agentAuth,
        agentApiKey: agentAuth === "api-key" ? agentApiKey.trim() || undefined : undefined,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      // The pod exists — this draft is spent. Clear it so a later launch starts fresh.
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* best-effort */
      }
      // Launch-into-T3 (3.2): a t3-control pod lands DIRECTLY on the URL-backed setup-token wizard
      // (?wiz=renew-then-t3) — its single 1-year login — instead of a transient ?enableT3=1 flag. This
      // is what makes the flow feel solid: the wizard is the FIRST thing rendered (no cockpit flash) and
      // it survives a refresh (the ?wiz param persists), where the old flag was stripped and fell back to
      // "Sign in to Claude" (fix/t3-wizard-polish, #1 + #6). Its onDone runs the T3 enable.
      const t3Suffix =
        control === "t3"
          ? // Claude → straight to its setup-token wizard (the single 1-year login); a Codex-only T3 pod
            // has no Claude token, so fall back to the legacy enable path (Codex keeps its device login).
            providers.includes("claude-code")
            ? "?wiz=renew-then-t3"
            : "?enableT3=1"
          : "";
      router.push(`/dashboard/pods/${r.id}${t3Suffix}`);
    });
  }

  if (pending) {
    return (
      <div className="flex flex-col gap-5">
        <WizardProgress current="creating" />
        <Card>
          <CardHeader>
            <CardTitle>Creating your pod</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5">
            <ProvisionStages agent={agent} />
            <p className="text-[13px] text-muted-foreground">
              A real machine with persistent storage, booting from scratch (times are approximate).
              You’ll be handed to the sign-in step automatically.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <WizardProgress current="configure" />

      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">{STEP_LABELS[step]}</p>
        <p className="text-[12px] tabular-nums text-muted-foreground">{idx + 1} / {steps.length}</p>
      </div>

      {/* No outer card on wizard steps — the step content sits directly on the page (aligned with the
          header), same as the cockpit tab pages; a bordered card here is a redundant box that just adds
          padding (owner call, 2026-08-30). See ui-patterns "Rows & lists". */}
      <Card className="border-0 bg-transparent py-0 shadow-none">
        <CardContent className="flex flex-col gap-5 px-0">
          {step === "basics" && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pod-name" className="flex items-center gap-2">
                  Name
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="pod-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name this pod — also names the session in your Claude app"
                  maxLength={60}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{oss ? "Machine resources" : "Size"}</Label>
                {oss ? (
                  <HostResourceChooser
                    capacity={capacity}
                    cpus={cpus}
                    memoryMb={memoryMb}
                    onCpus={setCpus}
                    onMemoryMb={setMemoryMb}
                  />
                ) : (
                  <SizePicker value={size} onChange={setSize} />
                )}
                {!oss && (
                  <p className="text-[13px] text-muted-foreground">
                    Reserved compute for this pod. You can change it later (a brief restart).
                  </p>
                )}
                {!slots.unlimited && (
                  <p className={`text-[13px] ${slotsFit ? "text-muted-foreground" : "text-destructive"}`}>
                    Uses <strong>{slotCost}</strong> of your <strong>{slotsFree}</strong> free slot
                    {slotsFree === 1 ? "" : "s"}.{" "}
                    {!slotsFit && (
                      <>
                        Suspend a pod to free some, or{" "}
                        <button
                          type="button"
                          onClick={() => openSupportChat(`I'd like more than ${slots.cap} slots on my Podbay account.`)}
                          className="font-medium text-[var(--accent-light)] hover:underline"
                        >
                          contact support
                        </button>{" "}
                        for more.
                      </>
                    )}
                  </p>
                )}
              </div>
            </>
          )}

          {step === "github" && (
            <div className="flex flex-col gap-2">
              {oss ? (
                // Self-host connects GitHub from INSIDE the pod (gh device login), which needs the
                // pod running — so the clone happens after boot, not here.
                <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-[13px] text-muted-foreground">
                  You&apos;ll connect GitHub and pick a repo <span className="font-medium text-foreground">after the pod boots</span> —
                  open the pod, then <span className="font-medium text-foreground">Settings → Connect GitHub</span>. It clones into{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/work</code> once you&apos;re signed in.
                </div>
              ) : (
                <GithubRepoField onSelect={setGithubRepo} />
              )}
            </div>
          )}

          {step === "agents" && (
            <>
              {/* Agents — multi-select, ≥1. Every env offers every agent, so this always shows. */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline gap-2">
                  <Label>Agents</Label>
                  <span className="text-[12px] font-normal text-muted-foreground/80">pick one or more</span>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {offered.map((id) => {
                    const on = providers.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          if (on && providers.length === 1) return; // enforce ≥1
                          toggleProvider(id);
                        }}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          on ? "border-primary/50 bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`flex size-[15px] items-center justify-center rounded border text-[10px] ${
                            on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                          }`}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <AgentLogo agent={id} className="size-4" />
                        {AGENT_LABELS[id] ?? id}
                      </button>
                    );
                  })}
                </div>
                <p className={`text-[13px] ${providers.length === 0 ? "text-warning" : "text-muted-foreground"}`}>
                  {providers.length === 0
                    ? "Pick at least one agent — a pod must run at least one."
                    : "The agent CLIs that run on this pod. You'll sign in to each during setup."}
                </p>
              </div>

              {/* Control — Podbay vs T3 Code (t3-unattended-integration 3.1). Hidden when the T3 harness
                  is disabled (agent-harness-toggle §2.1); control then stays pinned to its "podbay" default. */}
              {t3Enabled && (
              <div className="flex flex-col gap-2.5">
                <Label>Control</Label>
                <div className="inline-flex w-fit rounded-md border border-border p-0.5" role="radiogroup" aria-label="Control">
                  {(["podbay", "t3"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={control === m}
                      onClick={() => setControl(m)}
                      className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        control === m ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "t3" && <AgentLogo agent="t3" className="size-4" />}
                      {m === "podbay" ? "Podbay" : "T3 Code"}
                    </button>
                  ))}
                </div>
                {control === "podbay" ? (
                  <p className="text-[13px] text-muted-foreground">
                    Podbay drives your agents. Subscription sign-in — great for interactive use, but needs a re-login
                    roughly monthly.
                  </p>
                ) : (
                  <div className="rounded-lg border border-sky-400/25 bg-sky-400/[0.04] p-3.5">
                    <div className="text-[13.5px] font-semibold text-sky-300">T3 Code — control all agents from one app</div>
                    <p className="mt-1.5 text-[13px] text-muted-foreground">
                      Use T3 Code on phone or desktop to control your agents on this pod&mdash;even while you&rsquo;re away.
                      While enabled, it replaces Podbay&rsquo;s built-in agent controls.
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.7px] text-muted-foreground">
                      <li>Stay signed in for one year: sign in once during setup, with no monthly reauthentication.</li>
                      <li>Turn off T3 Code anytime to return to Podbay&rsquo;s controls.</li>
                    </ul>
                    <a
                      href="https://t3.codes"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-block text-[12.7px] font-medium text-sky-400 hover:underline"
                    >
                      Learn more about T3 Code ↗
                    </a>
                  </div>
                )}
              </div>
              )}

              {SHOW_API_KEY_MODE && (
              <div className="flex flex-col gap-2">
                <Label>Agent authentication</Label>
                <div
                  className="inline-flex w-fit rounded-md border border-border p-0.5"
                  role="radiogroup"
                  aria-label="Agent authentication"
                >
                  {(["subscription", "api-key"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={agentAuth === m}
                      onClick={() => setAgentAuth(m)}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        agentAuth === m
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "subscription" ? "Subscription" : "API key"}
                    </button>
                  ))}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {agentAuth === "subscription"
                    ? "Signs in with your Claude/Codex subscription — best for interactive use."
                    : "Runs on your own API key — the clean path for unattended, scheduled, or agent-to-agent pods (pay-per-token)."}
                </p>
                {agentAuth === "api-key" && (
                  <SecretInput
                    className="max-w-md"
                    placeholder={agent === "codex" ? "OPENAI_API_KEY (sk-…)" : "ANTHROPIC_API_KEY (sk-ant-…)"}
                    value={agentApiKey}
                    onChange={setAgentApiKey}
                  />
                )}
              </div>
              )}
            </>
          )}

          {step === "secrets" && (
            <>
              {secrets.map((s) => (
                <div key={s.key} className="flex flex-col gap-2">
                  <Label htmlFor={`secret-${s.key}`} className="flex items-center gap-2">
                    {s.key}
                    {s.required && <span className="text-destructive">*</span>}
                    {s.url && (
                      <a
                        className="text-xs font-medium text-[var(--accent-light)] hover:underline"
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Get it&nbsp;↗
                      </a>
                    )}
                  </Label>
                  {s.description && (
                    <p className="text-[13px] text-muted-foreground">{s.description}</p>
                  )}
                  <SecretInput
                    id={`secret-${s.key}`}
                    autoComplete="new-password"
                    value={values[s.key] ?? ""}
                    onChange={(v) => setValues((vals) => ({ ...vals, [s.key]: v }))}
                    onPasteEnv={applyPaste}
                    placeholder={s.required ? "Required" : "Optional"}
                  />
                </div>
              ))}

              {extraKeys.map((key) => (
                <div key={key} className="flex flex-col gap-2">
                  <Label htmlFor={`extra-${key}`} className="flex items-center justify-between gap-2">
                    <span className="font-mono">{key}</span>
                    <button
                      type="button"
                      className="text-xs font-medium text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setExtraKeys((ks) => ks.filter((k) => k !== key));
                        setValues((vals) => {
                          const next = { ...vals };
                          delete next[key];
                          return next;
                        });
                      }}
                    >
                      Remove
                    </button>
                  </Label>
                  <SecretInput
                    id={`extra-${key}`}
                    autoComplete="new-password"
                    value={values[key] ?? ""}
                    onChange={(v) => setValues((vals) => ({ ...vals, [key]: v }))}
                    onPasteEnv={applyPaste}
                    placeholder="value…"
                  />
                </div>
              ))}

              {(secrets.length > 0 || extraKeys.length > 0) && (
                <p className="text-[13px] text-muted-foreground">
                  Stored encrypted, scoped to this pod, and available to the app from first boot. Tip:
                  paste a <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.env</code> into any
                  field to fill several at once.
                </p>
              )}
            </>
          )}

          {step === "review" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Review &amp; launch</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{name.trim() || <span className="text-destructive">not set</span>}</dd>
                <dt className="text-muted-foreground">{oss ? "Resources" : "Size"}</dt>
                <dd>
                  {oss ? (
                    <>
                      {cpus != null ? `${cpus} vCPU` : "CPU: no limit"} ·{" "}
                      {memoryMb != null ? `${(memoryMb / 1024).toFixed(memoryMb % 1024 ? 1 : 0)} GB RAM` : "RAM: no limit"}
                    </>
                  ) : (
                    <>
                      {POD_TIERS[size].label} — {POD_TIERS[size].cpus} vCPU · {POD_TIERS[size].memoryGb} GB
                      RAM · {POD_TIERS[size].diskGb} GB disk
                    </>
                  )}
                </dd>
                {byoRepo && (
                  <>
                    <dt className="text-muted-foreground">Repository</dt>
                    <dd className="font-mono">
                      {githubRepo ?? <span className="text-destructive">not chosen</span>}
                    </dd>
                  </>
                )}
                {agentIds.length > 1 && (
                  <>
                    <dt className="text-muted-foreground">Agent</dt>
                    <dd>{AGENT_LABELS[agent] ?? agent}</dd>
                  </>
                )}
                {(secrets.length > 0 || extraKeys.length > 0) && (
                  <>
                    <dt className="text-muted-foreground">Secrets</dt>
                    <dd>
                      {secrets.filter((s) => (values[s.key] ?? "").trim().length > 0).length} of{" "}
                      {secrets.length} set
                      {extraKeys.length > 0 && ` · ${extraKeys.length} added`}
                    </dd>
                  </>
                )}
              </dl>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {!launchable && !error && (
                <p className="text-[13px] text-muted-foreground">
                  {!repoPicked
                    ? "Pick the repository you want to work on to continue."
                    : !requiredFilled
                      ? "Fill the required secrets to continue."
                      : !keyProvided
                        ? "Enter your API key (or switch to Subscription) to continue."
                        : !slotsFit
                          ? `This ${slotCost}-slot pod won’t fit your ${slotsFree} free slots — pick a smaller size, suspend a pod, or contact support for more.`
                          : "Provisioning isn’t enabled yet."}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <Button variant="outline" onClick={back} disabled={isFirst}>
              Back
            </Button>
            {isLast ? (
              <Button onClick={submit} disabled={!launchable}>
                Create pod
              </Button>
            ) : (
              <Button onClick={next} disabled={!canAdvance}>
                Next
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
