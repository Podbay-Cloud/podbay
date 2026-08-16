"use client";

import { useRef } from "react";

/** Sticky key bar for keys touch keyboards lack. `ctrl` is a sticky toggle.
 *  Buttons preventDefault on mousedown so they never blur the terminal (which
 *  would drop the on-screen keyboard). ⌫ and arrows auto-repeat on hold. */
export default function KeyBar({
  onSeq,
  ctrlActive,
  onToggleCtrl,
  onPaste,
}: {
  onSeq: (seq: string) => void;
  ctrlActive: boolean;
  onToggleCtrl: () => void;
  onPaste: () => void;
}) {
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHold = () => {
    if (delay.current) clearTimeout(delay.current);
    if (repeat.current) clearInterval(repeat.current);
    delay.current = repeat.current = null;
  };
  // Fire once now, then auto-repeat after a short hold (like a physical key).
  const startHold = (seq: string) => {
    stopHold();
    onSeq(seq);
    delay.current = setTimeout(() => {
      repeat.current = setInterval(() => onSeq(seq), 55);
    }, 350);
  };

  const hold = (seq: string, label: string, glyph: string) => (
    <button
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        startHold(seq);
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
    >
      {glyph}
    </button>
  );

  const tap = (seq: string, glyph: string, label?: string) => (
    <button aria-label={label} onClick={() => onSeq(seq)}>
      {glyph}
    </button>
  );

  return (
    // Keep the terminal focused: a mousedown on the bar must not blur the
    // xterm textarea, or the mobile keyboard closes.
    <div
      className="keybar"
      role="toolbar"
      aria-label="Terminal keys"
      onMouseDown={(e) => e.preventDefault()}
    >
      {tap("\x1b", "Esc")}
      {tap("\t", "Tab")}
      <button
        className={ctrlActive ? "on" : ""}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleCtrl}
      >
        Ctrl
      </button>
      <button aria-label="Paste" onMouseDown={(e) => e.preventDefault()} onClick={onPaste}>
        📋
      </button>
      {/* Device soft-keyboards don't auto-repeat Backspace into xterm, so keep a
          hold-to-repeat ⌫ alongside Paste. */}
      {hold("\x7f", "Backspace", "⌫")}
      {hold("\x1b[A", "Up", "↑")}
      {hold("\x1b[B", "Down", "↓")}
      {hold("\x1b[D", "Left", "←")}
      {hold("\x1b[C", "Right", "→")}
      {tap("/", "/")}
      {tap("|", "|")}
    </div>
  );
}
