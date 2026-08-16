"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { looksLikeEnvBlob, parseEnvBlob, type EnvPair } from "@/lib/env-paste";

/**
 * Masked secret input with a show/hide eye toggle. Selects all on focus so a
 * click-then-paste replaces the value wholesale. Secrets are write-only (the
 * stored value is never returned to the client), so the dots only ever mask what
 * the user types here — there's nothing to pre-fill.
 *
 * The eye is shown ONLY when the field has input. On an empty field (e.g. a
 * set-but-write-only secret in the manage dialog) an eye would be a misleading
 * affordance — it can't reveal the *stored* value, only what you type — so we
 * hide it until there's something of yours to reveal.
 */
export function SecretInput({
  value,
  onChange,
  onEnter,
  onPasteEnv,
  placeholder,
  disabled,
  id,
  autoComplete = "off",
  autoFocus,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  /** When set, pasting a multi-line `.env` blob here is intercepted and handed off
   * as parsed pairs instead of dumped into this one field (see `looksLikeEnvBlob`).
   * A single-value paste is unaffected. */
  onPasteEnv?: (pairs: EnvPair[]) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const hasValue = value.length > 0;
  return (
    // ph-no-capture: the eye toggle can turn this into a PLAINTEXT field, so masking
    // by input type is not enough — session replay must never record this wrapper.
    <div className={`relative min-w-0 ph-no-capture ${className ?? ""}`}>
      <Input
        id={id}
        // Empty always masks — a reveal only ever applies to what the user typed.
        type={show && hasValue ? "text" : "password"}
        className="pr-9"
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        // A pasted .env blob is distributed across keys rather than dumped here; a
        // single value pastes normally.
        onPaste={(e) => {
          if (!onPasteEnv) return;
          const text = e.clipboardData.getData("text");
          if (looksLikeEnvBlob(text)) {
            e.preventDefault();
            onPasteEnv(parseEnvBlob(text));
          }
        }}
        // Select-all on focus (click or tab) so a paste replaces the value.
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
      />
      {/* Eye only when there's input of the user's own to reveal — never a
          dead "peek the stored value" affordance on an empty field. */}
      {hasValue && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={show ? "Hide value" : "Show value"}
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
