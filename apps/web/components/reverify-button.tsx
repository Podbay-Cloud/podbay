"use client";

import { useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reverifyFetchDomain } from "@/lib/admin-pod-actions";

/**
 * "Check this again" — ages every verdict for a domain so the next pod re-climbs.
 *
 * It does NOT delete the row: the counts are what distinguish a rung that is flaky
 * from one that is dead, and an operator asking for a re-check has not asked to
 * throw that away.
 */
export default function ReverifyButton({ domain }: { domain: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[11px] text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-[12px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reverifyFetchDomain(domain);
            if (r?.error) setError(r.error);
          })
        }
      >
        <RotateCw className="size-3.5" />
        {pending ? "…" : "Re-check"}
      </Button>
    </span>
  );
}
