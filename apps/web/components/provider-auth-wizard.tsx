"use client";

import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { PhaseHeader } from "@/components/phase-header";
import ClaudeSigninWizard from "@/components/claude-signin-wizard";
import ClaudeRenewTokenWizard from "@/components/claude-renew-token-wizard";
import type { AuthStep } from "@/lib/provider-auth-steps";

const PROVIDER_LABEL: Record<string, string> = { "claude-code": "Claude", codex: "Codex" };

/**
 * The ONE provider sign-in flow (t3-unattended-integration, Phase A / D6). Given the `AuthStep[]` that
 * `computeAuthSteps` produced, it runs each step in sequence with a stepper header, reusing the existing
 * per-provider wizards (embedded) as the step bodies — so launch, switch-to-T3, cockpit add-provider, and
 * renew/expiry all render through THIS, with no duplicated sign-in UI.
 *
 * `stepIndex` is owned by the caller (URL-backed via the cockpit, so a refresh mid-flow resumes). A step's
 * success calls onComplete → we advance, or finish (onDone) after the last one. The back button aborts the
 * whole flow (onCancel). `reconnect` applies to a subscription/device step whose login is dead (wipe+relogin).
 */
export default function ProviderAuthWizard({
  slug,
  name,
  environmentName,
  steps,
  stepIndex,
  onStepIndex,
  onDone,
  onCancel,
  reconnect = false,
}: {
  slug: string;
  name: string | null;
  environmentName: string;
  steps: AuthStep[];
  stepIndex: number;
  onStepIndex: (i: number) => void;
  onDone: () => void;
  onCancel: () => void;
  reconnect?: boolean;
}) {
  const step = steps[stepIndex];
  // Defensive: an out-of-range / empty step list means the flow is already satisfied — finish cleanly.
  // onDone in an effect, never in the render body (calling a parent's setState during render is the
  // React anti-pattern the review flagged, #5).
  useEffect(() => {
    if (!step) onDone();
  }, [step, onDone]);
  if (!step) return null;
  const total = steps.length;
  const advance = () => (stepIndex + 1 < total ? onStepIndex(stepIndex + 1) : onDone());
  const signinMode = reconnect ? ("reconnect" as const) : ("signin" as const);
  // Single-step: name the provider in the header (restores the agent-control-wizards mockup intent —
  // a provider-specific title — inside the unified flow). Multi-step: the stepper counter.
  const providerName = PROVIDER_LABEL[step.provider] ?? step.provider;
  const singleLabel =
    step.kind === "claude-setup-token"
      ? "Set up Claude’s 1-year login"
      : reconnect
        ? `Reconnect ${providerName}`
        : `Sign in to ${providerName}`;

  const body =
    step.kind === "claude-setup-token" ? (
      <ClaudeRenewTokenWizard
        slug={slug}
        name={name}
        environmentName={environmentName}
        embedded
        onComplete={advance}
        onClose={onCancel}
      />
    ) : (
      <ClaudeSigninWizard
        slug={slug}
        name={name}
        environmentName={environmentName}
        agentId={step.provider}
        providerLabel={PROVIDER_LABEL[step.provider] ?? step.provider}
        mode={signinMode}
        embedded
        onComplete={advance}
        onClose={onCancel}
      />
    );

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <button
        type="button"
        onClick={onCancel}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to {name?.trim() || slug}
      </button>

      <PhaseHeader
        title={name?.trim() || slug}
        label={total > 1 ? `Sign in your agents · Step ${stepIndex + 1} of ${total}` : singleLabel}
        tone="warning"
      />
      <p className="font-mono text-[12px] text-muted-foreground/70">{environmentName}</p>

      {total > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
          {steps.map((s, i) => (
            <span
              key={`${s.provider}-${s.kind}`}
              className={`inline-flex items-center gap-1.5 ${
                i === stepIndex ? "font-semibold text-foreground" : i < stepIndex ? "text-success" : "text-muted-foreground/70"
              }`}
            >
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  i === stepIndex ? "bg-warning" : i < stepIndex ? "bg-success" : "bg-muted-foreground/40"
                }`}
              />
              {PROVIDER_LABEL[s.provider] ?? s.provider}
              {i < stepIndex ? " ✓" : ""}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4">{body}</div>
    </div>
  );
}
