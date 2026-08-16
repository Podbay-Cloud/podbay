"use client";

import { use, useEffect, useState } from "react";
import { linkify } from "@/lib/linkify";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ReachOut } from "@/lib/contacts";
import { STATUSES, type Lead, type Status } from "@/lib/types";

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [channel, setChannel] = useState("email");
  const [body, setBody] = useState("");

  useEffect(() => {
    fetch(`/api/leads/${id}`).then((r) => (r.ok ? r.json() : null)).then(setLead);
  }, [id]);

  async function patch(p: Partial<Lead>) {
    setLead((l) => (l ? { ...l, ...p } : l)); // optimistic
    const saved = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }).then((r) => r.json());
    setLead(saved);
  }

  async function logMessage() {
    if (!body.trim()) return;
    const text = body;
    setBody("");
    const saved = await fetch(`/api/leads/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, body: text }),
    }).then((r) => r.json());
    setLead(saved);
  }

  if (!lead) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8 text-sm text-muted-foreground">Loading…</main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/crm" className="text-sm text-muted-foreground hover:text-foreground">← Back to pipeline</Link>

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
        <Badge variant="outline" className="capitalize">{lead.status}</Badge>
      </div>
      {lead.handle && <div className="text-sm text-muted-foreground">{lead.handle}</div>}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {STATUSES.map((s: Status) => (
          <button
            key={s}
            onClick={() => patch({ status: s })}
            className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${
              lead.status === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Reach out — the ways to contact this lead, clickable. Sits ABOVE "next
          action" on purpose: knowing HOW to reach someone is the thing you came
          to this page for. */}
      <Card className="mt-6">
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Reach out</div>
            <div className="text-xs text-muted-foreground">opens in a new tab</div>
          </div>
          <ReachOut lead={lead} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="flex flex-col gap-1.5 py-4">
          <div className="text-sm font-medium">Next action</div>
          <Input
            placeholder="e.g. Reply on their Reddit thread"
            defaultValue={lead.nextAction ?? ""}
            onBlur={(e) => patch({ nextAction: e.target.value })}
          />
        </CardContent>
      </Card>

      {lead.fitNotes && (
        <Card className="mt-4">
          <CardContent className="py-4">
            <div className="text-sm font-medium">Fit notes</div>
            <p className="mt-1 text-sm text-muted-foreground">{lead.fitNotes}</p>
          </CardContent>
        </Card>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Conversation log
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {lead.messages.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages logged yet.</p>
        )}
        {lead.messages.map((m) => (
          <Card key={m.id}>
            <CardContent className="py-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="capitalize">{m.channel || "note"}</span>
                <span>{new Date(m.at).toLocaleString()}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{linkify(m.body)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex gap-2">
          {["email", "dm", "reddit", "note"].map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`rounded-full border px-3 py-1 text-xs capitalize ${
                channel === c ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <textarea
          className="min-h-20 w-full rounded-md border bg-transparent p-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          placeholder="Log outreach sent, a reply, or a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button className="self-start" onClick={logMessage} disabled={!body.trim()}>Log message</Button>
      </div>
    </main>
  );
}
