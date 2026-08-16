"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reliable paste on mobile: iOS/Android block `clipboard.readText()` outside a
 * trusted gesture, so instead we give the user a real textarea the OS lets them
 * paste into (long-press → Paste), then write it to the PTY. Used as the fallback
 * when the direct clipboard read fails (see pod-terminal `paste`).
 */
export default function PasteBox({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="paste-backdrop" onMouseDown={onCancel}>
      <div className="paste-box" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Paste into terminal">
        <label className="paste-label" htmlFor="paste-input">
          Paste here, then Insert
        </label>
        <textarea
          id="paste-input"
          ref={ref}
          className="paste-input"
          value={value}
          placeholder="Long-press → Paste"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          // Submit on paste-then-Enter for single-line values (e.g. an API key);
          // Shift+Enter keeps a literal newline for multi-line paste.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(value);
            }
          }}
        />
        <div className="paste-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSubmit(value)} disabled={!value}>
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
