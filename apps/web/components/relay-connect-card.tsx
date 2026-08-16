"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Check, Radio, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mintRelayCommand, myRelayStatus, type RelayCommand } from "@/lib/relay-actions";
import { copyText } from "@/lib/clipboard";

/**
 * Bring up a relay for your own machine.
 *
 * The relay lets a pod fetch pages that refuse a datacenter IP — through your own
 * connection, from your own browser. You run one command on your computer; the pod
 * never touches your machine except to ask it to fetch a page and get the result back.
 *
 * The command carries a single-use, short-lived code — so the card mints it on demand
 * and shows the countdown, rather than leaving a live code sitting on the page.
 */
export default function RelayConnectCard({
  initial,
}: {
  initial: { connected: boolean; loginDomains: string[] };
}) {
  const [status, setStatus] = useState(initial);
  const [cmd, setCmd] = useState<RelayCommand | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Poll connection status while the card is open, so running the command flips the
  // badge to "connected" without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => void myRelayStatus().then(setStatus).catch(() => undefined), 4000);
    return () => clearInterval(t);
  }, []);

  const generate = () =>
    start(async () => {
      setError(null);
      setCopied(false);
      try {
        setCmd(await mintRelayCommand());
      } catch {
        setError("Could not generate a command — try again.");
      }
    });

  const copy = async () => {
    if (!cmd) return;
    if (await copyText(cmd.command)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setError("Copy failed — select the command and copy it manually.");
    }
  };

  const expiresInMin = cmd ? Math.max(0, Math.round((cmd.expiresAt - Date.now()) / 60000)) : 0;

  return (
    <Card className="gap-1 py-4">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Radio className="size-3.5" />
          Relay — fetch from your own machine
        </CardTitle>
        {status.connected ? (
          <Badge className="bg-success/15 text-success hover:bg-success/15">Connected</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not connected
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 py-0">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Some websites block traffic from datacenters. Podbay Relay lets your pods fetch those sites
          through your computer&apos;s internet connection. Start it with one command and leave it
          running. Pages open signed out by default; to use your account on a specific site, sign in
          once with <code className="rounded bg-muted px-1 py-0.5 text-[11px]">relay login</code>.
        </p>

        {status.connected && status.loginDomains.length > 0 && (
          <p className="text-[12px] text-muted-foreground">
            Signed in for:{" "}
            {status.loginDomains.map((d) => (
              <span key={d} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                {d}
              </span>
            ))}
          </p>
        )}

        {!cmd ? (
          <Button size="sm" onClick={generate} disabled={pending} className="h-8">
            <Terminal className="size-3.5" />
            {pending ? "Generating…" : status.connected ? "Connect another machine" : "Generate command"}
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-muted-foreground">
              Run this on your computer (needs Node.js). The code is single-use and expires in about{" "}
              {expiresInMin} min:
            </p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-[12px]">
                {cmd.command}
              </code>
              <Button variant="outline" size="sm" onClick={copy} className="h-auto shrink-0 px-2">
                {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={generate} disabled={pending} className="h-7 px-2 text-[12px]">
              {pending ? "…" : "Generate a new one"}
            </Button>
          </div>
        )}

        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
