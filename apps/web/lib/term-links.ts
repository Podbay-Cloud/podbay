import type { Terminal, ILink } from "@xterm/xterm";

/**
 * Multi-row link detection for xterm.
 *
 * TUIs (the Claude /login box, for one) print long URLs as SEPARATE full-width
 * rows — hard line breaks, not soft wrapping — so the stock web-links addon
 * only ever linkifies the first row, and clicking it opens a truncated URL.
 *
 * This provider rejoins them: a URL match that runs to the end of a full-width
 * row absorbs following rows while they consist purely of URL characters (a
 * short row ends the URL). Hovering ANY row of the URL underlines the whole
 * thing, and activating opens the complete URL. Single-row URLs work as usual.
 */

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
/** Chars that may legally continue a URL on the next row (no whitespace). */
const CONT_RE = /^[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]+$/;
const SCHEME_RE = /https?:\/\//;

export function registerMultiRowLinkProvider(
  term: Terminal,
  open: (uri: string) => void,
): void {
  const lineText = (row: number): string =>
    term.buffer.active.getLine(row)?.translateToString(true) ?? "";
  // xterm marks a row that soft-wrapped from the row above (a single logical
  // line the terminal split at the edge) with isWrapped — the most reliable
  // join signal when it's available (plain output, e.g. a preview URL).
  const isWrapped = (row: number): boolean =>
    term.buffer.active.getLine(row)?.isWrapped === true;
  // Used width of a row in CELLS (not JS string length — a double-width char like
  // a leading emoji would otherwise make a full row look short).
  const usedCells = (row: number): number => {
    const line = term.buffer.active.getLine(row);
    if (!line) return 0;
    if (typeof line.getCell !== "function") return line.translateToString(true).length; // test fallback
    for (let x = line.length - 1; x >= 0; x--) {
      const cell = line.getCell(x);
      const ch = cell?.getChars() ?? "";
      if (ch !== "" && ch !== " ") return x + Math.max(1, cell?.getWidth?.() ?? 1);
    }
    return 0;
  };
  // "Full enough that the URL wrapped here" — tolerant of a ragged edge, since a
  // URL can wrap a few cells short of the margin (the next token didn't fit).
  const isFullRow = (row: number): boolean => usedCells(row) >= term.cols * 0.7;
  const isContinuation = (s: string): boolean =>
    s.length > 0 && CONT_RE.test(s) && !SCHEME_RE.test(s);

  term.registerLinkProvider({
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const hovered = bufferLineNumber - 1; // buffer rows are 0-based

      // The hovered row may be a continuation row — walk up to the logical start:
      // soft-wrapped rows join upward unconditionally; TUI-drawn full-width URL
      // rows (no isWrapped flag) join via the character heuristic.
      let start = hovered;
      while (
        start > 0 &&
        (isWrapped(start) || (isContinuation(lineText(start)) && isFullRow(start - 1)))
      ) {
        start -= 1;
      }

      const startText = lineText(start);
      const links: ILink[] = [];
      URL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = URL_RE.exec(startText))) {
        let url = m[0];
        let endRow = start;
        let endCol = m.index + m[0].length;

        // Absorb following rows while the URL runs to the edge of a full row
        // (hard-drawn) or the next row is a soft-wrap continuation.
        if (endCol === startText.length && (isFullRow(start) || isWrapped(start + 1))) {
          let row = start;
          for (;;) {
            const nextRow = row + 1;
            const next = lineText(nextRow);
            const wrapped = isWrapped(nextRow);
            if (!wrapped && !isContinuation(next)) break;
            url += next;
            row = nextRow;
            endRow = row;
            endCol = next.length;
            if (wrapped) {
              if (!isWrapped(nextRow + 1)) break; // last wrapped segment
            } else if (!isFullRow(nextRow)) {
              break; // short row = tail of a hard-drawn URL
            }
          }
        }

        if (hovered >= start && hovered <= endRow) {
          links.push({
            range: {
              start: { x: m.index + 1, y: start + 1 },
              end: { x: endCol, y: endRow + 1 },
            },
            text: url,
            activate: (event: MouseEvent, text: string) => {
              if (event.button === 0) open(text);
            },
          });
        }
      }
      callback(links.length ? links : undefined);
    },
  });
}
