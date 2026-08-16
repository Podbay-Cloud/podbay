/**
 * Minimal ANSI styling for the CLI's human-facing output.
 *
 * Off automatically when stdout is not a TTY (piped/redirected) or when NO_COLOR is
 * set — so `pb ... | cat` and CI logs stay clean, never littered with escape codes.
 */
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  green: wrap("32"),
  cyan: wrap("36"),
  yellow: wrap("33"),
  red: wrap("31"),
};

/**
 * Render aligned "command — description" rows: the command padded to a common width
 * and coloured, the description dimmed, so a help block reads as a table instead of a
 * wall of text.
 */
export function rows(pairs: [cmd: string, desc: string][], color: (s: string) => string = c.cyan): string {
  const w = Math.max(...pairs.map(([cmd]) => cmd.length));
  return pairs.map(([cmd, desc]) => `  ${color(cmd.padEnd(w))}  ${c.dim(desc)}`).join("\n");
}
