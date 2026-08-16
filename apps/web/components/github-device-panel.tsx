"use client";

import { Button } from "@/components/ui/button";
import { CopyCodeButton } from "@/components/copy-code-button";

/**
 * The GitHub device-flow instructions block, shared by the pod cockpit's Connect
 * chip and the launch form's repo field. It lives in one place because the two
 * had drifted: the launch form printed a bare "go to <url> and enter CODE —
 * waiting…" line while the cockpit had the copyable code + button. Same flow, so
 * the same UI.
 */
export function GithubDevicePanel({
  userCode,
  verificationUri,
}: {
  userCode: string;
  verificationUri: string;
}) {
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border/60 bg-white/[0.02] px-3.5 py-3 text-[12.5px]">
      <div className="text-muted-foreground">1. Copy this code &nbsp; 2. Open GitHub and paste it to authorize:</div>
      <div className="flex flex-wrap items-center gap-2">
        <CopyCodeButton
          code={userCode}
          className="px-2.5 py-1.5 text-base tracking-[0.2em]"
        />
        <Button asChild variant="outline" size="sm">
          <a href={verificationUri} target="_blank" rel="noopener noreferrer">
            Open GitHub
          </a>
        </Button>
        <span className="text-muted-foreground">Waiting for authorization…</span>
      </div>
    </div>
  );
}
