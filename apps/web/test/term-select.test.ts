import { describe, expect, it } from "vitest";
import { selectionRange } from "../lib/term-select";

const COLS = 80;

describe("selectionRange", () => {
  it("selects within a single row", () => {
    expect(selectionRange({ col: 3, row: 5 }, { col: 10, row: 5 }, COLS)).toEqual({
      col: 3,
      row: 5,
      length: 8,
    });
  });

  it("spans multiple rows as a contiguous block of cells", () => {
    // (col 70,row 5) → (col 4,row 7): 10 tail + 80 + 5 head = 95 cells.
    expect(selectionRange({ col: 70, row: 5 }, { col: 4, row: 7 }, COLS)).toEqual({
      col: 70,
      row: 5,
      length: 95,
    });
  });

  it("is order-independent (drag up == drag down)", () => {
    const a = { col: 70, row: 5 };
    const b = { col: 4, row: 7 };
    expect(selectionRange(a, b, COLS)).toEqual(selectionRange(b, a, COLS));
  });

  it("a single cell has length 1", () => {
    expect(selectionRange({ col: 2, row: 2 }, { col: 2, row: 2 }, COLS)).toEqual({
      col: 2,
      row: 2,
      length: 1,
    });
  });
});
