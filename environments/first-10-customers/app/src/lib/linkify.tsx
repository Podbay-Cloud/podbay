import React from "react";

/** URLs and bare emails. Deliberately conservative: http(s) only (never `javascript:`
 * or `data:`), and trailing punctuation is left out of the link so "see https://x.com."
 * doesn't swallow the full stop. */
const PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]|[\w.+-]+@[\w-]+\.[\w.-]+)/g;

/**
 * Render text with URLs and emails as links, leaving everything else as plain text.
 *
 * Why a helper and not `dangerouslySetInnerHTML`: message bodies are drafts the agent
 * wrote from FETCHED web content, so treating them as HTML would turn any scraped page
 * into a script-injection vector in the founder's own CRM. Building React elements
 * means the text can never execute — the content is only ever a string.
 *
 * Links open in a new tab with `rel="noopener noreferrer"` so a prospect's site can
 * neither reach back through `window.opener` nor read the referrer.
 */
export function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PATTERN.lastIndex = 0;

  while ((m = PATTERN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const isEmail = !token.startsWith("http");
    out.push(
      <a
        key={`${m.index}-${token}`}
        href={isEmail ? `mailto:${token}` : token}
        {...(isEmail ? {} : { target: "_blank", rel: "noopener noreferrer" })}
        // break-all: a long URL must not overflow the card on mobile.
        // text-primary: links should LOOK clickable, not inherit body colour.
        className="text-primary underline underline-offset-2 hover:opacity-80 break-all"
      >
        {token}
      </a>,
    );
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
