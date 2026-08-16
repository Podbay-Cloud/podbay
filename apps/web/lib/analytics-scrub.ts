/**
 * Scrub credential-shaped values out of anything analytics is about to send.
 *
 * `capture_exceptions` ships exception messages, stack frames and the current URL.
 * Today none of our client errors carry a credential — the terminal socket is
 * cookie-authenticated with no token in its URL, and error text is surfaced through
 * component state rather than thrown. That is a property of the code as it is right
 * now, not a guarantee: the leak arrives the day someone writes
 * `throw new Error(\`fetch failed: \${urlWithToken}\`)`, and nothing in review would
 * catch it because the leak happens in a third-party pipeline nobody is looking at.
 *
 * So this runs on every outbound event. Matching is by SHAPE — URL userinfo,
 * sensitive query parameters, values after an assignment or auth header — rather
 * than by vendor prefix, so no literal token pattern lives in this repo and our own
 * leak scan of it comes back clean.
 */

/** Query parameters whose VALUE is a credential regardless of length. */
const SENSITIVE_PARAMS = /^(code|token|access_token|id_token|state|key|api_key|secret|password|sig|signature)$/i;

const PATTERNS: [RegExp, string][] = [
  // https://user:pass@host → strip the userinfo
  [/:\/\/[^/@\s]+:[^/@\s]+@/g, "://REDACTED@"],
  // token=…, "apiKey": "…", Authorization: Bearer …
  [/((?:token|key|secret|password|passwd|auth)["'\s]*[=:]["'\s]*)[A-Za-z0-9_./+-]{12,}/gi, "$1REDACTED"],
  [/(authorization["'\s]*[=:]["'\s]*[A-Za-z]+\s+)[A-Za-z0-9_./+=-]{12,}/gi, "$1REDACTED"],
];

export function scrubText(input: string): string {
  let out = input;
  for (const [re, to] of PATTERNS) out = out.replace(re, to);
  return out;
}

/**
 * Redact sensitive query values in a URL, keeping the shape so the event stays
 * useful — you still learn WHICH page threw, just not the credential on it.
 *
 * Deliberately value-based rather than length-based: an OAuth `code` is short
 * enough to slip past a "long opaque string" rule.
 */
export function scrubUrl(input: string): string {
  const scrubbed = scrubText(input);
  const q = scrubbed.indexOf("?");
  if (q === -1) return scrubbed;
  const [base, query] = [scrubbed.slice(0, q), scrubbed.slice(q + 1)];
  const parts = query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return pair;
    const name = pair.slice(0, eq);
    return SENSITIVE_PARAMS.test(decodeURIComponent(name)) ? `${name}=REDACTED` : pair;
  });
  return `${base}?${parts.join("&")}`;
}

/** Keys whose values are URLs that analytics records on every event. */
const URL_KEYS = new Set(["$current_url", "$referrer", "$pathname", "url"]);

/**
 * Scrub one analytics event in place-ish (returns a new properties object).
 * Unknown shapes are passed through untouched — a scrubber that throws would take
 * the whole capture pipeline down with it, which is a worse failure than the one it
 * prevents.
 */
export function scrubEventProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string") {
      out[k] = URL_KEYS.has(k) ? scrubUrl(v) : scrubText(v);
    }
  }
  // Exception payloads: type + message + stack frames, one entry per chained error.
  const list = out.$exception_list;
  if (Array.isArray(list)) {
    out.$exception_list = list.map((e) => {
      if (!e || typeof e !== "object") return e;
      const ex = { ...(e as Record<string, unknown>) };
      if (typeof ex.value === "string") ex.value = scrubText(ex.value);
      if (typeof ex.type === "string") ex.type = scrubText(ex.type);
      return ex;
    });
  }
  return out;
}
