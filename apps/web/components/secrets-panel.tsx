"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Copy, Check, Download } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import {
  setPodSecret,
  clearPodSecret,
  revealPodSecret,
  revealAllPodSecrets,
} from "@/lib/actions";
import { apiGet } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { copyText } from "@/lib/clipboard";
import { toEnvFile } from "@/lib/env-file";
import { useConfirm } from "@/components/ui/use-confirm";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Badge } from "@/components/ui/badge";
import { type EnvPair, parseEnvBlob } from "@/lib/env-paste";

type Secret = {
  key: string;
  description: string | null;
  required: boolean;
  set: boolean;
  url: string | null;
  /** Declared by the env (→ "Clear") vs an arbitrary added var (→ "Delete"). */
  declared: boolean;
};

/**
 * Write-only secrets panel for a pod, rendered inline as the cockpit's Secrets tab.
 * Loads the env's declared secrets and whether each is set — never a value. The owner
 * can set a new value, clear it, add an arbitrary variable, or paste a whole `.env`
 * blob into any value field to set many at once.
 */
type Request = { key: string; description: string; at: string };

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export default function SecretsPanel({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  // Secrets + requests via react-query: cached (re-opening Secrets is instant), bounded retry (a
  // rejected fetch shows an error, never sticks on "Loading…"), and one query for both.
  const { data, isLoading } = useQuery({
    queryKey: qk.secrets(slug),
    // A Route Handler (GET), not a server action — so the tab load runs on the parallel HTTP lane and
    // isn't starved by the live poll. The endpoint returns both secrets and still-open requests
    // (already filtered to keys the env doesn't declare), so the client just consumes them.
    queryFn: () => apiGet<{ secrets: Secret[]; requests: Request[] }>(`/api/pods/${slug}/secrets`),
  });
  const secrets = data?.secrets ?? null;
  const requests = data?.requests ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.secrets(slug) });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Values fetched on an explicit reveal — kept in memory only, dropped on hide.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  // Keys currently in "replace" (edit) mode, showing the typed-value input.
  const [editing, setEditing] = useState<Record<string, true>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  // Pasted .env pairs awaiting REVIEW — shown as editable rows the owner saves one by one (or all),
  // never auto-committed (velsa's call: a paste shouldn't silently write secrets).
  const [staged, setStaged] = useState<EnvPair[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [pending, start] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Export EVERY set secret as a .env — download (a file, the default, doesn't linger in the
  // clipboard) or copy. Behind a confirm because it exposes all values at once; server logs it.
  const exportAll = async (mode: "download" | "copy") => {
    const setCount = secrets?.filter((s) => s.set).length ?? 0;
    if (setCount === 0) {
      setNotice("No secrets are set yet.");
      return;
    }
    const ok = await confirm({
      title: `Export ${setCount} secret${setCount === 1 ? "" : "s"} as .env?`,
      message: "This reveals every value at once. The action is logged.",
      confirmLabel: mode === "copy" ? "Copy .env" : "Download .env",
    });
    if (!ok) return;
    setExporting(true);
    void revealAllPodSecrets(slug).then(async (r) => {
      setExporting(false);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      const body = toEnvFile(r.env);
      if (mode === "copy") {
        if (await copyText(body)) {
          setExportCopied(true);
          window.setTimeout(() => setExportCopied(false), 1500);
        }
        return;
      }
      const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.env`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  };


  const addArbitrary = () => {
    const key = newKey.trim();
    if (!KEY_RE.test(key) || !newVal) return;
    start(async () => {
      const r = await setPodSecret(slug, key, newVal);
      if (r?.error) setError(r.error);
      else {
        setNewKey("");
        setNewVal("");
        await invalidate();
      }
    });
  };

  const save = (key: string) => {
    const value = drafts[key] ?? "";
    if (!value) return;
    start(async () => {
      const r = await setPodSecret(slug, key, value);
      if (r?.error) setError(r.error);
      else {
        setDrafts((d) => ({ ...d, [key]: "" }));
        hide(key); // a revealed value is now stale
        stopEdit(key);
        await invalidate();
      }
    });
  };

  const clear = async (key: string, declared: boolean) => {
    const verb = declared ? "Clear" : "Delete";
    const ok = await confirm({
      title: `${verb} ${key}?`,
      message: `${
        declared ? "The pod loses this value (the variable stays declared)." : "This removes the variable from the pod."
      } This can't be undone.`,
      confirmLabel: verb,
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await clearPodSecret(slug, key);
      if (r?.error) setError(r.error);
      else {
        hide(key);
        await invalidate();
      }
    });
  };

  const hide = (key: string) =>
    setRevealed((m) => {
      const { [key]: _drop, ...rest } = m;
      return rest;
    });

  const startEdit = (key: string) => {
    hide(key);
    setEditing((e) => ({ ...e, [key]: true }));
  };
  const stopEdit = (key: string) => {
    setDrafts((d) => ({ ...d, [key]: "" }));
    setEditing((e) => {
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
  };

  // Fetch and show one value in-place (server-side owner-gated + audited). A plain
  // async fetch — NOT a transition — so it never flips the panel-wide `pending` flag
  // (that made every disabled={pending} control flash on an eye/copy click).
  const reveal = (key: string) => {
    setError(null);
    void revealPodSecret(slug, key).then((r) => {
      if ("error" in r) setError(r.error);
      else setRevealed((m) => ({ ...m, [key]: r.value }));
    });
  };

  // Copy the value without necessarily showing it on screen — fetches if needed
  // (each fetch is audited server-side, same as a reveal). Also fetch-not-transition.
  const copy = (key: string) => {
    const put = async (v: string) => {
      if (!(await copyText(v))) return; // HTTP-safe copy; no lying "copied" state on failure
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    };
    if (key in revealed) return put(revealed[key]);
    setError(null);
    void revealPodSecret(slug, key).then((r) => {
      if ("error" in r) setError(r.error);
      else put(r.value);
    });
  };

  // Pasting a `.env` blob STAGES its pairs for review (below) — it does NOT auto-save. The owner
  // edits/removes and saves the ones they want. Merges into any already-staged set (last value wins).
  const applyPaste = (pairs: EnvPair[]) => {
    const valid = pairs.filter((p) => KEY_RE.test(p.key) && p.value.length > 0);
    const invalid = pairs.length - valid.length;
    if (valid.length === 0) {
      setNotice(invalid > 0 ? `Nothing to review — ${invalid} line(s) weren’t valid KEY=VALUE.` : null);
      return;
    }
    setError(null);
    setStaged((cur) => {
      const byKey = new Map(cur.map((p) => [p.key, p.value]));
      for (const p of valid) byKey.set(p.key, p.value);
      return [...byKey.entries()].map(([key, value]) => ({ key, value }));
    });
    setNotice(
      `${valid.length} variable${valid.length === 1 ? "" : "s"} ready to review below — save the ones you want` +
        (invalid > 0 ? ` (${invalid} invalid line${invalid === 1 ? "" : "s"} skipped)` : "") +
        ".",
    );
  };

  const editStaged = (key: string, value: string) =>
    setStaged((s) => s.map((p) => (p.key === key ? { key, value } : p)));
  const removeStaged = (key: string) => setStaged((s) => s.filter((p) => p.key !== key));

  const saveStaged = (key: string) => {
    const pair = staged.find((p) => p.key === key);
    if (!pair || !pair.value) return;
    start(async () => {
      const r = await setPodSecret(slug, pair.key, pair.value);
      if (r?.error) setError(r.error);
      else {
        removeStaged(key);
        await invalidate();
      }
    });
  };

  const saveAllStaged = () => {
    if (staged.length === 0) return;
    setError(null);
    start(async () => {
      let saved = 0;
      for (const p of staged) {
        if (!p.value) continue;
        const r = await setPodSecret(slug, p.key, p.value);
        if (r?.error) {
          setError(r.error);
          return;
        }
        saved += 1;
      }
      setStaged([]);
      await invalidate();
      setNotice(`Saved ${saved} variable${saved === 1 ? "" : "s"}.`);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Secrets</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your secrets stay encrypted until you reveal or copy them. Each action is logged.
          </p>
        </div>
        {secrets && secrets.some((s) => s.set) && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={exporting} onClick={() => exportAll("download")}>
              <Download className="mr-1.5 size-3.5" />
              {exporting ? "Exporting…" : "Export .env"}
            </Button>
            <Button size="sm" variant="ghost" disabled={exporting} onClick={() => exportAll("copy")} title="Copy all as .env">
              {exportCopied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </p>
      )}
      {isLoading && secrets === null && !error && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      )}

      {requests.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
          <p className="text-[13px] font-semibold text-warning">The agent is asking for these</p>
          <ul className="mt-3 flex flex-col gap-4">
            {requests.map((req) => (
              <li key={req.key}>
                <code className="font-mono text-sm font-semibold">{req.key}</code>
                {req.description && (
                  <p className="mt-1 text-[13px] text-muted-foreground">{req.description}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SecretInput
                    className="flex-1"
                    placeholder="Enter value…"
                    value={drafts[req.key] ?? ""}
                    disabled={pending}
                    onChange={(v) => setDrafts((d) => ({ ...d, [req.key]: v }))}
                    onEnter={() => save(req.key)}
                    onPasteEnv={applyPaste}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || !(drafts[req.key] ?? "").length}
                    onClick={() => save(req.key)}
                  >
                    Save
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-border p-4">
        <p className="text-[13px] font-semibold">Add a variable</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Or paste a whole <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.env</code> (or
          several <code className="rounded bg-muted px-1 py-0.5 text-[11px]">KEY=VALUE</code> lines) into
          either box to <span className="font-medium">review and add</span> several at once — nothing is
          saved until you confirm.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            className="w-full font-mono text-sm sm:w-48"
            placeholder="NAME"
            value={newKey}
            disabled={pending}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            // Any KEY=VALUE pasted into the NAME box — even a single line like NOTION_SECRET="x" —
            // is a secret to add, not a name, so stage it for review. A bare key (no '=') still just
            // fills the name normally.
            onPaste={(e) => {
              const pairs = parseEnvBlob(e.clipboardData.getData("text"));
              if (pairs.length >= 1) {
                e.preventDefault();
                setNewKey("");
                applyPaste(pairs);
              }
            }}
          />
          <SecretInput
            className="flex-1"
            placeholder="Enter value…"
            value={newVal}
            disabled={pending}
            onChange={setNewVal}
            onEnter={addArbitrary}
            onPasteEnv={applyPaste}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !KEY_RE.test(newKey.trim()) || !newVal}
            onClick={addArbitrary}
          >
            Add
          </Button>
        </div>
        {newKey.trim() && !KEY_RE.test(newKey.trim()) && (
          <p className="mt-1.5 text-[12px] text-destructive">
            Name must be UPPER_SNAKE_CASE and start with a letter (e.g. OPENAI_API_KEY).
          </p>
        )}
      </div>

      {staged.length > 0 && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">
              Review {staged.length} pasted variable{staged.length === 1 ? "" : "s"} — save the ones you want
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStaged([])}>
                Discard
              </Button>
              <Button size="sm" disabled={pending} onClick={saveAllStaged}>
                Save all
              </Button>
            </div>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {staged.map((p) => {
              const overwrites = secrets?.some((s) => s.key === p.key && s.set);
              return (
                <li key={p.key} className="flex flex-wrap items-center gap-2">
                  <code className="w-full font-mono text-[12px] sm:w-56">
                    {p.key}
                    {overwrites && <span className="ml-1 font-sans text-warning">overwrites</span>}
                  </code>
                  <Input
                    className="min-w-0 flex-1 font-mono text-xs"
                    value={p.value}
                    disabled={pending}
                    onChange={(e) => editStaged(p.key, e.target.value)}
                  />
                  <Button size="sm" variant="outline" disabled={pending || !p.value} onClick={() => saveStaged(p.key)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Remove ${p.key}`}
                    onClick={() => removeStaged(p.key)}
                  >
                    ✕
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ul className="flex flex-col gap-4">
        {secrets?.map((s) => {
          const shown = s.key in revealed;
          const isEditing = s.key in editing;
          return (
            <li key={s.key} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-sm font-semibold">{s.key}</code>
                {/* No pill for a set secret — the filled field already says so. Only an
                    unset secret needs a status (is it required?). */}
                {!s.set && (
                  <Badge
                    variant="outline"
                    className={s.required ? "border-warning/40 text-warning" : "text-muted-foreground"}
                  >
                    {s.required ? "required" : "not set"}
                  </Badge>
                )}
                {s.url && !s.set && (
                  <a
                    className="text-xs font-medium text-[var(--accent-light)] hover:underline"
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get it&nbsp;↗
                  </a>
                )}
              </div>
              {s.description && (
                <p className="mt-1.5 text-[13px] text-muted-foreground">{s.description}</p>
              )}

              {s.set && !isEditing ? (
                // Stored value: masked read-only field with an inline eye + copy.
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-0 flex-1 ph-no-capture">
                    <Input
                      readOnly
                      tabIndex={-1}
                      // A fixed mask (not the real length) so dots never leak how long it is.
                      value={shown ? revealed[s.key] : "••••••••••••"}
                      type="text"
                      // Clearly read-only (muted, no text cursor) — it's a display, not an
                      // input; use Edit to change the value.
                      className={`pr-16 font-mono cursor-default ${shown ? "select-all" : "select-none bg-muted/40 text-muted-foreground"}`}
                      aria-label={`${s.key} value`}
                      onFocus={(e) => shown && e.currentTarget.select()}
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center">
                      <button
                        type="button"
                        aria-label={shown ? "Hide value" : "Show value"}
                        onClick={() => (shown ? hide(s.key) : reveal(s.key))}
                        className="flex h-full items-center px-2 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label="Copy value"
                        onClick={() => copy(s.key)}
                        className="flex h-full items-center pl-1 pr-2.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {copiedKey === s.key ? (
                          <Check className="h-4 w-4 text-success" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => startEdit(s.key)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={pending}
                    onClick={() => clear(s.key, s.declared)}
                  >
                    {s.declared ? "Clear" : "Delete"}
                  </Button>
                </div>
              ) : (
                // Unset, or replacing: type a new value.
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SecretInput
                    className="flex-1"
                    placeholder={s.set ? "New value…" : "Enter value…"}
                    value={drafts[s.key] ?? ""}
                    disabled={pending}
                    autoFocus={isEditing}
                    onChange={(v) => setDrafts((d) => ({ ...d, [s.key]: v }))}
                    onEnter={() => save(s.key)}
                    onPasteEnv={applyPaste}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || !(drafts[s.key] ?? "").length}
                    onClick={() => save(s.key)}
                  >
                    Save
                  </Button>
                  {isEditing && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => stopEdit(s.key)}>
                      Cancel
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

    </div>
  );
}
