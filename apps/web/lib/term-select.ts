export interface CellPos {
  /** 0-based column. */
  col: number;
  /** 0-based absolute buffer row (includes scrollback). */
  row: number;
}

/**
 * The xterm `term.select(col, row, length)` arguments for a contiguous selection
 * between two cells on a grid `cols` wide, inclusive of both endpoints — the
 * block-of-cells shape a normal terminal drag-select produces. Order-independent.
 */
export function selectionRange(
  a: CellPos,
  b: CellPos,
  cols: number,
): { col: number; row: number; length: number } {
  const pa = a.row * cols + a.col;
  const pb = b.row * cols + b.col;
  const start = Math.min(pa, pb);
  const end = Math.max(pa, pb);
  return { col: start % cols, row: Math.floor(start / cols), length: end - start + 1 };
}
