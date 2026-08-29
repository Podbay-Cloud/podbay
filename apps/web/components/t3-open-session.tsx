"use client";

import { useState, type ReactNode } from "react";
import { Smartphone, Monitor } from "lucide-react";

/**
 * "Open this pod in T3" guidance — the T3-app steps for a CONNECTED pod, rendered in the Control-tab
 * "(i)" info modal (mirrors the Codex "Continue this Codex session" pattern). A connected environment
 * appears in the T3 app under **T3 Connect** but lands TOGGLED OFF — so the key step is turning it on.
 *
 * Copy is owner-provided (velsa, 2026-08-24): mobile = toggle the env on under T3 Connect; desktop =
 * Settings → Connections → Connect, then Add project → the env → Local folder → work (and say "hi" to
 * start the agent — it isn't auto-invoked).
 */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
      {children}
    </span>
  );
}

function StepList({ children }: { children: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {children.map((step, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {i + 1}
          </span>
          <span className="leading-relaxed">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function MobileSection({ podName }: { podName: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        It lands toggled off. Turn it on:
      </p>
      <StepList>
        {[
          <>
            <Chip>…</Chip> → <strong className="text-foreground">Environments</strong>.
          </>,
          <>
            Toggle <strong className="text-foreground">{podName}</strong> on.
          </>,
        ]}
      </StepList>
    </div>
  );
}

function DesktopSection({ podName }: { podName: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        In the T3 desktop app, enable the environment, then add it as a project.
      </p>
      <StepList>
        {[
          <>
            Go to <strong className="text-foreground">Settings → Connections</strong>. Under{" "}
            <strong className="text-foreground">Remote environments</strong>, click{" "}
            <strong className="text-foreground">Connect</strong> on{" "}
            <strong className="text-foreground">{podName}</strong>.
          </>,
          <>
            In the sidebar, click <strong className="text-foreground">Add project</strong> (the{" "}
            <Chip>folder +</Chip> icon).
          </>,
          <>
            Pick the environment <strong className="text-foreground">{podName}</strong> →{" "}
            <strong className="text-foreground">Local folder</strong> → <Chip>work</Chip>.
          </>,
          <>
            The session opens. The agent isn&rsquo;t started automatically — say{" "}
            <strong className="text-foreground">&ldquo;hi&rdquo;</strong> to kick it off.
          </>,
        ]}
      </StepList>
    </div>
  );
}

export function T3OpenSession({
  podName,
  platform,
}: {
  podName: string;
  platform?: "mobile" | "desktop";
}) {
  if (platform === "mobile") return <MobileSection podName={podName} />;
  if (platform === "desktop") return <DesktopSection podName={podName} />;
  return <TabbedT3OpenSession podName={podName} />;
}

function TabbedT3OpenSession({ podName }: { podName: string }) {
  const [tab, setTab] = useState<"mobile" | "desktop">("mobile");
  const button = (p: "mobile" | "desktop", icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setTab(p)}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
        tab === p ? "bg-white/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex self-start rounded-lg border border-border/60 p-0.5">
        {button("mobile", <Smartphone className="size-3.5" />, "Mobile")}
        {button("desktop", <Monitor className="size-3.5" />, "Desktop")}
      </div>
      {tab === "mobile" ? <MobileSection podName={podName} /> : <DesktopSection podName={podName} />}
    </div>
  );
}
