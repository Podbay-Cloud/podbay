"use client";

import { ClipboardPaste, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The ONE "paste the code back" row (ui-patterns: one primitive per job). Every place that opens an
 * auth/approval link and takes a pasted code — onboarding Claude sign-in, the sign-in/reconnect wizard,
 * the setup-token wizard, the inline agent card — renders THIS, so the layout never drifts again
 * (owner-flagged 2026-08-24). Layout: a FULL-WIDTH input (with a subtle clipboard-paste affordance
 * tucked inside), and the submit button on its own line UNDERNEATH. `submit` disables until there's a
 * non-empty value / while `submitting`.
 */
export function PasteCodeInput({
  value,
  onChange,
  onSubmit,
  submitting = false,
  submitted = false,
  submitLabel = "Submit code",
  submittedLabel = "Sent ✓",
  placeholder = "Paste the code here",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitted?: boolean;
  submitLabel?: string;
  submittedLabel?: string;
  placeholder?: string;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="relative w-full">
        <Input
          className="h-9 w-full pr-10 font-mono text-[13px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        <button
          type="button"
          aria-label="Paste from clipboard"
          title="Paste from clipboard"
          onClick={async () => {
            try {
              const t = await navigator.clipboard.readText();
              if (t) onChange(t.trim());
            } catch {
              /* clipboard blocked/denied — the user can paste manually */
            }
          }}
          className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <ClipboardPaste className="size-4" />
        </button>
      </div>
      <Button
        variant="outline"
        className="self-start"
        onClick={onSubmit}
        disabled={!value.trim() || submitting}
      >
        {submitting ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
        {submitted ? submittedLabel : submitLabel}
      </Button>
    </div>
  );
}
