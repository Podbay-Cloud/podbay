import { describe, expect, it, vi } from "vitest";
import type { Terminal, ILink } from "@xterm/xterm";
import { registerMultiRowLinkProvider } from "../lib/term-links";

/** Minimal fake Terminal: a buffer of plain-text rows + cols. `wrapped` marks
 *  rows xterm would flag as soft-wrap continuations of the row above. */
function fakeTerm(rows: string[], cols: number, wrapped: Set<number> = new Set()) {
  let provider: { provideLinks: (y: number, cb: (l: ILink[] | undefined) => void) => void };
  const term = {
    cols,
    buffer: {
      active: {
        getLine: (i: number) =>
          rows[i] === undefined
            ? undefined
            : {
                translateToString: () => rows[i],
                isWrapped: wrapped.has(i),
                length: cols,
                // Cell-accurate: astral chars (emoji) occupy 2 cells.
                getCell: (x: number) => {
                  let col = 0;
                  for (const ch of [...rows[i]]) {
                    const w = (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
                    if (x >= col && x < col + w) return { getChars: () => ch, getWidth: () => w };
                    col += w;
                  }
                  return { getChars: () => "", getWidth: () => 1 };
                },
              },
      },
    },
    registerLinkProvider: (p: typeof provider) => {
      provider = p;
    },
  } as unknown as Terminal;
  const open = vi.fn();
  registerMultiRowLinkProvider(term, open);
  const linksAt = (row1: number) => {
    let out: ILink[] | undefined;
    provider.provideLinks(row1, (l) => (out = l));
    return out;
  };
  return { linksAt, open };
}

const COLS = 80;
// A claude-login-style URL drawn as three hard rows: two exactly-full-width
// rows + a short tail (the shape the Claude /login box actually produces).
const R1 = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-8".slice(0, COLS);
const R2 = "8ed&scope=user%3Aprofile+user%3Ainference&code_challenge=abc123def456ghi789jklm".slice(0, COLS);
const R3 = "&code_challenge_method=S256&state=ENDMARKER";
const FULL = R1 + R2 + R3;

describe("registerMultiRowLinkProvider", () => {
  it("joins a TUI-drawn URL across rows and links every row to the full URL", () => {
    const { linksAt } = fakeTerm(["  Login", R1, R2, R3, "", "  Paste code >"], COLS);
    for (const row1 of [2, 3, 4]) {
      const links = linksAt(row1);
      expect(links, `row ${row1}`).toBeDefined();
      expect(links![0].text).toBe(FULL);
      expect(links![0].range.start.y).toBe(2);
      expect(links![0].range.end.y).toBe(4);
    }
  });

  it("joins a soft-wrapped URL (isWrapped tail) — the preview-URL case", () => {
    // A long preview URL xterm split at the edge: full first row + a short
    // continuation row flagged isWrapped. Both rows link to the whole URL.
    const head = ("https://curly-otter-9f3a.preview.podbay.cloud/app/dashboard?tab=" + "x".repeat(40)).slice(0, COLS);
    const tail = "&ref=share";
    const full = head + tail;
    const { linksAt } = fakeTerm(["Preview:", head, tail, "> "], COLS, new Set([2]));
    for (const row1 of [2, 3]) {
      const links = linksAt(row1);
      expect(links, `row ${row1}`).toBeDefined();
      expect(links![0].text).toBe(full);
      expect(links![0].range.start.y).toBe(2);
      expect(links![0].range.end.y).toBe(3);
    }
  });

  it("joins an emoji-prefixed URL that wrapped a few cells short (preview case)", () => {
    // A leading 🎮 (2 cells) + URL that wrapped mid-token, leaving a ragged edge —
    // the exact shape Claude Code drew the preview URL. Cell-accurate width + the
    // ragged-edge tolerance must still recognise row 1 as "full enough" to join.
    const head = "🎮https://right-crawdad-3990.preview.podb"; // ~41 cells of 44
    const tail = "ay.cloud";
    const { linksAt } = fakeTerm(["  ● Preview", head, tail, "> "], 44);
    for (const row1 of [2, 3]) {
      const links = linksAt(row1);
      expect(links, `row ${row1}`).toBeDefined();
      expect(links![0].text).toBe("https://right-crawdad-3990.preview.podbay.cloud");
    }
  });

  it("keeps ordinary single-row URLs intact", () => {
    const { linksAt } = fakeTerm(["see https://example.com/docs for info"], COLS);
    const links = linksAt(1);
    expect(links![0].text).toBe("https://example.com/docs");
    expect(links![0].range.start.y).toBe(1);
    expect(links![0].range.end.y).toBe(1);
  });

  it("does not absorb a following prose line", () => {
    const url = "https://example.com/x".padEnd(0, "");
    const fullRow = ("https://example.com/aaaa?" + "b=".repeat(60)).slice(0, COLS);
    const { linksAt } = fakeTerm([fullRow, "  Esc to cancel"], COLS);
    const links = linksAt(1);
    expect(links![0].text).toBe(fullRow);
    expect(links![0].range.end.y).toBe(1);
    expect(url).toBeTruthy();
  });

  it("activates with the complete URL", () => {
    const { linksAt, open } = fakeTerm([R1, R2, R3], COLS);
    const links = linksAt(2);
    links![0].activate({ button: 0 } as MouseEvent, links![0].text);
    expect(open).toHaveBeenCalledWith(FULL);
  });
});
