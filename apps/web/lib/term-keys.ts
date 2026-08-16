/**
 * Map a browser keydown to the byte sequence a terminal app expects, for the
 * editing shortcuts xterm doesn't emit usefully on its own. Pure + testable; the
 * terminal wires it through `attachCustomKeyEventHandler`.
 *
 * Sequences target Claude Code's line editor / readline conventions:
 *  - Shift/Alt+Enter → ESC+CR (`\x1b\r`): insert a newline instead of submitting.
 *    This is what Claude Code's `/terminal-setup` binds Shift+Enter to.
 *  - Alt+Left/Right → Meta-b / Meta-f (`\x1bb` / `\x1bf`): move by word.
 *  - Cmd(meta)+Left/Right → Ctrl-A / Ctrl-E (`\x01` / `\x05`): line start / end.
 *  - Alt+Backspace → Ctrl-W-ish (`\x1b\x7f`): delete the previous word.
 *
 * Returns the bytes to send, or null to let xterm handle the key normally.
 */
export interface KeyLike {
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export function keydownToSeq(e: KeyLike): string | null {
  const { key, altKey, metaKey, ctrlKey, shiftKey } = e;

  // Newline-without-submit. Ctrl is left alone (Ctrl+Enter has its own meaning).
  if (key === "Enter" && (shiftKey || altKey) && !metaKey && !ctrlKey) {
    return "\x1b\r";
  }

  // Word motion — Alt+Arrow. (Meta/Cmd handled below for line motion.)
  if (altKey && !metaKey && !ctrlKey) {
    if (key === "ArrowLeft") return "\x1bb";
    if (key === "ArrowRight") return "\x1bf";
    if (key === "Backspace") return "\x1b\x7f"; // delete previous word
  }

  // Line motion — Cmd(meta)+Arrow → start/end of line.
  if (metaKey && !ctrlKey) {
    if (key === "ArrowLeft") return "\x01"; // Ctrl-A
    if (key === "ArrowRight") return "\x05"; // Ctrl-E
  }

  return null;
}
