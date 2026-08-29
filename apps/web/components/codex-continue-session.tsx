"use client";

import { useState, type ReactNode } from "react";
import { Smartphone, Monitor } from "lucide-react";

/**
 * The "Continue this Codex session" guidance — ONE source, rendered verbatim by BOTH the Codex info
 * "(i)" modal AND the Codex pairing wizard's "Open your session" step, so the two can never drift
 * (agent-control-wizards, 0audit). The flow lives in the **ChatGPT app** (Codex was merged in), NOT a
 * separate "Codex app". Copy is owner-approved (velsa, 2026-08-23).
 *
 * `platform` undefined → both sections (the modal); "mobile"/"desktop" → just one (the wizard step 2,
 * which follows the wizard's Phone/Desktop tab).
 */

/** An inline chip for a menu item / glyph, so the nav steps read as UI. */
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
        Once paired, this pod appears automatically in <strong className="text-foreground">Remote</strong>.
      </p>
      <StepList>
        {[
          <>
            Open <strong className="text-foreground">ChatGPT</strong> → <Chip>☰</Chip> Menu →{" "}
            <strong className="text-foreground">Remote</strong>.
          </>,
          <>
            Under <strong className="text-foreground">Projects</strong>, find{" "}
            <strong className="text-foreground">work</strong> with{" "}
            <strong className="text-foreground">{podName}</strong> shown underneath.
          </>,
          <>Tap it to continue your session.</>,
        ]}
      </StepList>
    </div>
  );
}

function DesktopSection({ podName }: { podName: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Add this pod as a remote project once. After that, you can open it directly from{" "}
        <strong className="text-foreground">Projects</strong>.
      </p>
      <StepList>
        {[
          <>
            In the sidebar, click <Chip>+</Chip> next to <strong className="text-foreground">Projects</strong>.
          </>,
          <>
            Choose <strong className="text-foreground">Remote</strong> → <strong className="text-foreground">Next</strong>.
          </>,
          <>
            Name the project after this pod: <strong className="text-foreground">{podName}</strong>.
          </>,
          <>
            Under <strong className="text-foreground">Remote host</strong>, choose{" "}
            <strong className="text-foreground">{podName}</strong>.
          </>,
          <>
            Set <strong className="text-foreground">Source folder</strong> to{" "}
            <strong className="text-foreground">work</strong>. If it shows <Chip>/home/dev</Chip>, replace
            it—your project is in <Chip>/home/dev/work</Chip>.
          </>,
          <>
            Click <strong className="text-foreground">Add project</strong>.
          </>,
        ]}
      </StepList>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Next time, just select the project from the sidebar.
      </p>
    </div>
  );
}

export function CodexContinueSession({
  podName,
  platform,
}: {
  podName: string;
  /** Fix to one platform (no tabs). Omit → the tabbed version (Phone / Desktop), used by the info modal. */
  platform?: "mobile" | "desktop";
}) {
  if (platform === "mobile") return <MobileSection podName={podName} />;
  if (platform === "desktop") return <DesktopSection podName={podName} />;
  return <TabbedContinueSession podName={podName} />;
}

function TabbedContinueSession({ podName }: { podName: string }) {
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
