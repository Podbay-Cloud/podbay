/**
 * Small brand marks for the Claude / Codex launch picker, so the agent choice is
 * recognizable at a glance. These are lightweight STYLIZED marks in each brand's
 * accent color (an 8-ray spark for Claude/Anthropic, a 6-petal knot for Codex/OpenAI)
 * — not the exact official artwork (a self-contained page can't fetch remote assets).
 * Drop in the official SVGs here to make them pixel-exact.
 */
export function AgentLogo({ agent, className = "size-5" }: { agent: string; className?: string }) {
  if (agent === "t3" || agent === "t3-code") {
    // T3 Code — a "T3" mark in its sky→indigo brand gradient (stand-in; drop the official SVG here).
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded bg-gradient-to-br from-sky-500 to-indigo-500 text-white ${className}`}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" width="88%" height="88%">
          <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="800" letterSpacing="-0.6" fill="currentColor">
            T3
          </text>
        </svg>
      </span>
    );
  }
  if (agent === "codex") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded bg-[#0b0b0c] text-white ${className}`}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" width="72%" height="72%" fill="none" stroke="currentColor" strokeWidth="1.6">
          {[0, 60, 120].map((a) => (
            <ellipse key={a} cx="12" cy="12" rx="9" ry="3.6" transform={`rotate(${a} 12 12)`} />
          ))}
        </svg>
      </span>
    );
  }
  // Claude / Anthropic
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded bg-[#C15F3C] text-white ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width="72%" height="72%" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        {[0, 45, 90, 135].map((a) => (
          <line key={a} x1="12" y1="3.5" x2="12" y2="20.5" transform={`rotate(${a} 12 12)`} />
        ))}
      </svg>
    </span>
  );
}
