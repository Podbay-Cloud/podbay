"use client";

/**
 * The pod cockpit's "Claude settings" modal — a deliberately SMALL editor for the slice of the
 * pod's ~/.claude/settings.json that matters for an agent running headless / remote-controlled and
 * often unattended on a 24/7 pod. See packages/control-plane/src/claude-settings.ts for why THESE
 * keys and not others (model/env/autoUpdates are handled by the client, podbay, or the image).
 * Only rendered when Claude Code is one of the pod's agents and the pod is running.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getClaudeSettings, saveClaudeSettings } from "@/lib/actions";
import type { ClaudeSettings, ClaudeAttribution } from "@podbay/control-plane";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AttrMode = "default" | "hidden" | "custom";

/** Per-row hint (the "subtitle"): reads as a distinct, quieter layer below the setting NAME via
 * three cues — a different family (mono vs the UI sans), a smaller size, and a dimmer grey
 * (#6b7688, a step below muted-foreground) against the label's near-white `foreground`. */
// Match the pod Settings tab's row description EXACTLY (SettingRow `desc`): same sans font, same
// muted-foreground colour, same size — one settings design across the cockpit.
const HINT = "mt-0.5 text-[12.5px] text-muted-foreground";
const LABEL = "text-sm font-medium";

/** Accessible switch (role="switch") hand-rolled to avoid pulling a second primitive library —
 * behaviour matches @/components/ui semantics (keyboard-focusable button, aria-checked). */
function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <div className={LABEL}>{label}</div>
        {hint && <div className={HINT}>{hint}</div>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      {/* Section title in the accent (a distinct COLOR from the white setting names + dim subtitles),
          uppercased as a small section eyebrow so the three groups read as dividers. */}
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-light)]">
        {title}
      </h4>
      <div className="divide-y divide-border/50">{children}</div>
    </section>
  );
}

/** A commit/PR attribution control: Default (Claude's trailer) · Hidden (empty) · Custom (only shown
 * when the pod already has custom text, so editing another field never silently discards it). */
function AttributionRow({
  id,
  label,
  hint,
  mode,
  setMode,
  custom,
}: {
  id: string;
  label: string;
  hint: string;
  mode: AttrMode;
  setMode: (m: AttrMode) => void;
  custom: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className={LABEL}>{label}</div>
        <div className={HINT}>{hint}</div>
      </div>
      <Select value={mode} onValueChange={(v) => setMode(v as AttrMode)}>
        <SelectTrigger id={id} className="h-8 w-[130px] flex-none text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          <SelectItem value="hidden">Hidden</SelectItem>
          {mode === "custom" && (
            <SelectItem value="custom">Custom: {custom.slice(0, 20) || "…"}</SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

/** One duration/select row (Question timeout, Permission dialog expiry). */
function SelectRow({
  label,
  hint,
  value,
  onChange,
  opts,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  opts: { v: string; l: string }[];
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className={LABEL}>{label}</div>
        <div className={HINT}>{hint}</div>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[150px] flex-none text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o.v} value={o.v}>
              {o.l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const ASK_OPTS = [
  { v: "never", l: "Never (wait forever)" },
  { v: "5m", l: "5 minutes" },
  { v: "15m", l: "15 minutes" },
  { v: "30m", l: "30 minutes" },
  { v: "1h", l: "1 hour" },
];
const DIALOG_OPTS = [
  { v: "5m", l: "5 minutes" },
  { v: "10m", l: "10 minutes" },
  { v: "30m", l: "30 minutes" },
  { v: "1h", l: "1 hour" },
];

type FormFields = {
  askTimeout: string;
  dialogExpiry: string;
  pushNotif: boolean;
  awaySummary: boolean;
  autoCompact: boolean;
  sessionUrl: boolean;
  commitMode: AttrMode;
  commitCustom: string;
  prMode: AttrMode;
  prCustom: string;
};

/** Stable signature of the editable form, so Save can enable ONLY when something actually changed.
 * Custom text only counts while its mode is "custom" (so stale hidden text never reads as dirty). */
function formSig(v: FormFields): string {
  return JSON.stringify([
    v.askTimeout,
    v.dialogExpiry,
    v.pushNotif,
    v.awaySummary,
    v.autoCompact,
    v.sessionUrl,
    v.commitMode,
    v.commitMode === "custom" ? v.commitCustom : "",
    v.prMode,
    v.prMode === "custom" ? v.prCustom : "",
  ]);
}

export default function ClaudeSettingsDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signature of the values as loaded — Save stays disabled until the form diverges from it.
  const [initialSig, setInitialSig] = useState("");

  // Unattended behaviour
  const [askTimeout, setAskTimeout] = useState("never");
  const [dialogExpiry, setDialogExpiry] = useState("5m");
  const [pushNotif, setPushNotif] = useState(true);
  const [awaySummary, setAwaySummary] = useState(false);
  // Git identity
  const [commitMode, setCommitMode] = useState<AttrMode>("default");
  const [prMode, setPrMode] = useState<AttrMode>("default");
  const [commitCustom, setCommitCustom] = useState("");
  const [prCustom, setPrCustom] = useState("");
  const [sessionUrl, setSessionUrl] = useState(true);
  // Long-session health
  const [autoCompact, setAutoCompact] = useState(true);

  function hydrate(s: ClaudeSettings) {
    const a = s.attribution ?? {};
    let commitMode: AttrMode = "default";
    let commitCustom = "";
    if (a.commit === "") commitMode = "hidden";
    else if (a.commit !== undefined) {
      commitMode = "custom";
      commitCustom = a.commit;
    }
    let prMode: AttrMode = "default";
    let prCustom = "";
    if (a.pr === "") prMode = "hidden";
    else if (a.pr !== undefined) {
      prMode = "custom";
      prCustom = a.pr;
    }
    const fields: FormFields = {
      askTimeout: s.askUserQuestionTimeout ?? "never",
      dialogExpiry: s.dialogExpiry ?? "5m",
      pushNotif: s.agentPushNotifEnabled ?? false,
      awaySummary: s.awaySummaryEnabled ?? false,
      autoCompact: s.autoCompactEnabled ?? true,
      sessionUrl: a.sessionUrl ?? true,
      commitMode,
      commitCustom,
      prMode,
      prCustom,
    };
    setAskTimeout(fields.askTimeout);
    setDialogExpiry(fields.dialogExpiry);
    setPushNotif(fields.pushNotif);
    setAwaySummary(fields.awaySummary);
    setAutoCompact(fields.autoCompact);
    setSessionUrl(fields.sessionUrl);
    setCommitMode(fields.commitMode);
    setCommitCustom(fields.commitCustom);
    setPrMode(fields.prMode);
    setPrCustom(fields.prCustom);
    setInitialSig(formSig(fields));
  }

  async function onOpenChange(next: boolean) {
    setOpen(next);
    setError(null);
    if (next) {
      setLoading(true);
      try {
        hydrate(await getClaudeSettings(slug));
      } finally {
        setLoading(false);
      }
    }
  }

  function attrValue(mode: AttrMode, custom: string): string | undefined {
    if (mode === "hidden") return "";
    if (mode === "custom") return custom;
    return undefined; // default → omit the field
  }

  async function save() {
    setSaving(true);
    setError(null);
    const attribution: ClaudeAttribution = { sessionUrl };
    const commit = attrValue(commitMode, commitCustom);
    const pr = attrValue(prMode, prCustom);
    if (commit !== undefined) attribution.commit = commit;
    if (pr !== undefined) attribution.pr = pr;
    const patch: ClaudeSettings = {
      askUserQuestionTimeout: askTimeout,
      dialogExpiry,
      agentPushNotifEnabled: pushNotif,
      awaySummaryEnabled: awaySummary,
      autoCompactEnabled: autoCompact,
      attribution,
    };
    const res = await saveClaudeSettings(slug, patch);
    setSaving(false);
    if ("error" in res) setError(res.error);
    else setOpen(false);
  }

  const dirty =
    formSig({
      askTimeout,
      dialogExpiry,
      pushNotif,
      awaySummary,
      autoCompact,
      sessionUrl,
      commitMode,
      commitCustom,
      prMode,
      prCustom,
    }) !== initialSig;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Claude settings</DialogTitle>
          <DialogDescription>Applies to Claude Code running on this pod.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            <Group title="Unattended operation">
              <SelectRow
                label="Question timeout"
                hint="How long the agent waits on an unanswered question before moving on."
                value={askTimeout}
                onChange={setAskTimeout}
                opts={ASK_OPTS}
              />
              <SelectRow
                label="Permission dialog expiry"
                hint="Deadline for an approval prompt forwarded to your phone/desktop."
                value={dialogExpiry}
                onChange={setDialogExpiry}
                opts={DIALOG_OPTS}
              />
              <Toggle
                id="cs-push"
                checked={pushNotif}
                onChange={setPushNotif}
                label="Push notifications"
                hint="Ping you (via the Claude app) when the agent needs you."
              />
              <Toggle
                id="cs-away"
                checked={awaySummary}
                onChange={setAwaySummary}
                label="Away summary"
                hint="Show a recap of what happened while you were gone."
              />
            </Group>

            <Group title="Git identity">
              <AttributionRow
                id="cs-commit"
                label="Commit attribution"
                hint="The Co-Authored-By trailer on commits."
                mode={commitMode}
                setMode={setCommitMode}
                custom={commitCustom}
              />
              <AttributionRow
                id="cs-pr"
                label="PR attribution"
                hint="The &ldquo;Generated with Claude Code&rdquo; line in pull requests."
                mode={prMode}
                setMode={setPrMode}
                custom={prCustom}
              />
              <Toggle
                id="cs-session"
                checked={sessionUrl}
                onChange={setSessionUrl}
                label="Session link in git"
                hint="Append the claude.ai session URL to commits/PRs."
              />
            </Group>

            <Group title="Long sessions">
              <Toggle
                id="cs-compact"
                checked={autoCompact}
                onChange={setAutoCompact}
                label="Auto-compact"
                hint="Automatically compact the conversation before it hits the limit."
              />
            </Group>

            {error && <p className="text-[13px] text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || loading || !dirty}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
