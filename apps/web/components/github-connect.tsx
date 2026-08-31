"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Check, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { githubConnStatus } from "@/lib/actions";
import { qk } from "@/lib/query-keys";

/**
 * The GitHub row in a pod's Settings: shows the connection status and links to the
 * dedicated add-GitHub WIZARD page (authorize → choose repo → clone into ~/work).
 * Renders nothing when GitHub connect isn't configured.
 */
export default function GithubConnect({ slug }: { slug: string }) {
  // Cached connection status (qk.github) — shared with the wizard page. A reject retries then errors
  // rather than sticking; until it resolves the row renders nothing (as before).
  const { data: status } = useQuery({
    queryKey: qk.github(slug),
    queryFn: () => githubConnStatus(slug),
  });
  const configured = status?.configured ?? null;
  const connected = status?.connected ?? false;
  const login = status?.login ?? null;

  if (configured === null || configured === false) return null;

  return (
    <div className="border-t border-border/60 py-3.5 first:border-t-0">
      <div className="flex min-h-[54px] items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <GitBranch className="h-3.5 w-3.5" /> GitHub
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            {connected ? (
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3 text-success" /> Connected as @{login}
              </span>
            ) : (
              "Connect to choose a repo to clone into ~/work"
            )}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/pods/${slug}/github?from=settings`}>{connected ? "Choose repo" : "Connect"}</Link>
        </Button>
      </div>
    </div>
  );
}
