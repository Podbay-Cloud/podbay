"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { contactSummary } from "@/lib/contacts";
import { STATUSES, type Lead, type Status } from "@/lib/types";

const STATUS_TONE: Record<Status, string> = {
  new: "",
  contacted: "border-blue-500/40 text-blue-500",
  replied: "border-amber-500/40 text-amber-500",
  conversation: "border-emerald-500/40 text-emerald-500",
  won: "border-emerald-600/50 text-emerald-600",
  lost: "text-muted-foreground",
};

export default function Pipeline() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", handle: "", source: "", fitNotes: "" });

  useEffect(() => {
    fetch("/api/leads").then((r) => r.json()).then(setLeads);
  }, []);

  const counts = useMemo(
    () => ({
      total: leads.length,
      contacted: leads.filter((l) => l.status !== "new").length,
      replied: leads.filter((l) => ["replied", "conversation", "won"].includes(l.status)).length,
      conversation: leads.filter((l) => ["conversation", "won"].includes(l.status)).length,
    }),
    [leads],
  );

  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);

  async function addLead() {
    const optimistic: Lead = {
      id: `tmp-${Date.now()}`,
      ...draft,
      status: "new",
      createdAt: new Date().toISOString(),
      messages: [],
    };
    setLeads((ls) => [optimistic, ...ls]);
    setOpen(false);
    setDraft({ name: "", handle: "", source: "", fitNotes: "" });
    const saved = (await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(optimistic),
    }).then((r) => r.json())) as Lead;
    setLeads((ls) => ls.map((l) => (l.id === optimistic.id ? saved : l)));
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Pipeline</div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">First 10 customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track every prospect from first touch to a booked conversation.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>+ Add lead</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New lead</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              {(["name", "handle", "source"] as const).map((f) => (
                <div key={f} className="flex flex-col gap-1.5">
                  <Label htmlFor={f} className="capitalize">{f}</Label>
                  <Input
                    id={f}
                    value={draft[f]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fitNotes">Fit notes</Label>
                <Input
                  id="fitNotes"
                  value={draft.fitNotes}
                  onChange={(e) => setDraft((d) => ({ ...d, fitNotes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={addLead} disabled={!draft.name.trim()}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total", counts.total],
          ["Contacted", counts.contacted],
          ["Replied", counts.replied],
          ["Conversations", counts.conversation],
        ].map(([label, n]) => (
          <Card key={label as string}>
            <CardContent className="py-4">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-1 text-3xl font-semibold">{n}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-1.5">
        {(["all", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${
              filter === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <Card className="mt-4">
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Source</TableHead>
                <TableHead className="hidden sm:table-cell">Contact</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    No leads yet — add your first prospect.
                  </TableCell>
                </TableRow>
              )}
              {shown.map((l) => (
                <TableRow key={l.id} className="relative hover:bg-muted/40">
                  <TableCell>
                    {/* Stretched link: a real anchor covering the whole row — keyboard-
                        focusable and cmd/middle-clickable, not just a JS onClick. */}
                    <Link
                      href={`/crm/${l.id}`}
                      className="font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      {l.name}
                    </Link>
                    {l.handle && <div className="text-xs text-muted-foreground">{l.handle}</div>}
                  </TableCell>
                  {/* Long values TRUNCATE rather than widen the table: every cell is
                      whitespace-nowrap, and the container scrolls — so an over-wide
                      table pushes Status out of SIGHT instead of breaking visibly.
                      (Dogfood find 2026-07-29.) Hover shows the full value. */}
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    <div className="max-w-[200px] truncate" title={l.source || undefined}>
                      {l.source || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {(() => {
                      const labels = contactSummary(l);
                      if (labels.length === 0)
                        return (
                          <span className="text-muted-foreground/60">
                            {l.contacts ? "no channel" : "—"}
                          </span>
                        );
                      return (
                        <div className="max-w-[180px] truncate" title={labels.join(", ")}>
                          <span className="font-medium">{labels[0]}</span>
                          {labels.length > 1 && (
                            <span className="text-muted-foreground">
                              {" · " + labels.slice(1).join(", ")}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize ${STATUS_TONE[l.status]}`}>{l.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
