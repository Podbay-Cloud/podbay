/**
 * Did the fetch actually return the page, or did it return a refusal wearing a 200?
 *
 * Measured from a pod (2026-07-30): a reader service answered HTTP 200 whose body was
 * the target site's "you've been blocked by network security" notice. Without this
 * check the agent summarises that as the page — confidently, and wrongly, which is
 * worse than returning nothing. Every rung's result goes through here before anyone
 * believes it.
 *
 * Pure on purpose: the interesting inputs are recorded pages, so the tests that
 * matter run in CI with no network.
 */

export type FetchRung = "api" | "direct" | "browser" | "archive" | "reader" | "relay";

/** Why a result was rejected. These are the values written to shared fetch memory,
 * so they are outcomes rather than free text. */
export type FetchOutcome =
  | "ok"
  | "blocked" // the source refused us (edge block, 403, upstream error via a reader)
  | "challenged" // bot-management interstitial; a human-ish gate, not an answer
  | "login" // content exists but requires a session we do not have
  | "timeout" // the rung didn't answer in time — TRANSIENT (slow/hung), not a refusal
  | "empty"; // transport fine, no content — usually a client-rendered shell

export interface VerifyInput {
  rung: FetchRung;
  status: number;
  /** Raw response body, exactly as received. Signatures are matched against THIS. */
  body: string;
  contentType?: string;
  /** Where we ended up, after redirects. */
  finalUrl?: string;
  /** Words the caller expected to find. Absence is a WARNING, never a rejection. */
  wanted?: string[];
  /** Minimum plausible text length. Some pages are legitimately short. */
  minText?: number;
}

export interface VerifyResult {
  ok: boolean;
  outcome: FetchOutcome;
  /** One actionable sentence, for a log or an agent's own reasoning. */
  reason: string;
  /** Non-fatal observations — relevance lives here so it can never discard a good fetch. */
  warnings: string[];
  textLength: number;
}

const DEFAULT_MIN_TEXT = 200;

/**
 * Text length above which a page is serving REAL content, whatever else is on it.
 *
 * This exists because signature matching alone produced a false negative on a live
 * page: crunchbase.com answers 200 with 23,156 characters of article text AND carries
 * Cloudflare's `challenge-platform` script — so a signature-only verifier threw away a
 * perfectly good page. The same trap is much wider than bot-management: any site with a
 * "Log in to continue" button in its header would have tripped the login signature
 * while serving the whole article.
 *
 * So a refusal signature means refusal only when the page is NOT also serving content.
 * Above this floor the signature becomes a warning: worth noting, not worth discarding.
 */
const SUBSTANTIAL_TEXT = 1200;

/**
 * Signatures are matched on the RAW body, not on extracted text.
 *
 * A bot-management page announces itself in markup a text extractor throws away —
 * `challenge-platform` lives in a script src. Matching only the visible text would
 * miss the clearest signal on the page.
 */
const SIGNATURES: { re: RegExp; outcome: FetchOutcome; reason: string }[] = [
  // A reader service that fetched for us reports the upstream status in the body,
  // while answering us 200. This is the single most useful signal we have.
  {
    re: /Warning:\s*Target URL returned error\s*(\d{3})/i,
    outcome: "blocked",
    reason: "the reader service reached the site and the site refused it",
  },
  {
    re: /blocked by network security|you have been blocked|access denied|permission to access/i,
    outcome: "blocked",
    reason: "the source refused this network",
  },
  {
    // "prove your humanity" / "prove you're (a) human" is reddit's interstitial, seen
    // 2026-08-01 served even to a residential relay browser — the whole page was the
    // challenge, not r/programming.
    re: /just a moment|challenge-platform|cf-browser-verification|cf_chl_|checking your browser|verify you are (a )?human|prove your humanity|prove you(’|'|)re (a )?human/i,
    outcome: "challenged",
    reason: "bot-management interstitial, not the page",
  },
  {
    re: /log in to (continue|your)|sign in to (continue|view)|create an account to continue|members[- ]only/i,
    outcome: "login",
    reason: "the content is behind a session we do not have",
  },
  {
    re: /please enable javascript|you need to enable javascript/i,
    outcome: "empty",
    reason: "the page requires a browser to render",
  },
];

/**
 * The body with `<noscript>` removed, for signature matching.
 *
 * A `<noscript>` block is a fallback for a browser we are NOT — matching it means
 * treating a page's fallback as its content. Measured: excalidraw.com renders 537
 * characters of real content in a browser AND carries a leftover
 * "You need to enable JavaScript to run this app" noscript, which made the verifier
 * call a perfectly good render `empty` and fall through to a reader service.
 *
 * A page that genuinely has nothing without JavaScript is still caught — by the text
 * floor, which is the honest mechanism for it.
 */
export function signatureBody(body: string): string {
  return body.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

/** Visible text, for plausibility only. Never used for signature matching. */
export function extractText(body: string, contentType?: string): string {
  if (contentType?.includes("json")) return body.trim();
  return body
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOGIN_PATH = /\/(login|signin|sign-in|auth|account\/login)(\/|\?|$)/i;

export function verifyFetch(input: VerifyInput): VerifyResult {
  const text = extractText(input.body, input.contentType);
  const sigBody = signatureBody(input.body);
  const warnings: string[] = [];
  const fail = (outcome: FetchOutcome, reason: string): VerifyResult => ({
    ok: false,
    outcome,
    reason,
    warnings,
    textLength: text.length,
  });

  // 1. Transport. Cheapest, and unambiguous when it fails — but note we still run the
  //    signature pass afterwards for a 200, because that is where the lies live.
  if (input.status >= 400) {
    const sig = SIGNATURES.find((s) => s.re.test(sigBody));
    // A 403 that is really a challenge should be recorded as a challenge: the two
    // want different next moves (different origin vs. a browser).
    return fail(sig?.outcome ?? "blocked", sig ? sig.reason : `the source answered ${input.status}`);
  }

  // A redirect that landed on a sign-in page is a login wall, whatever the status.
  if (input.finalUrl && LOGIN_PATH.test(input.finalUrl)) {
    return fail("login", "the request was redirected to a sign-in page");
  }

  // 2. Signatures — the refusals served WITH a success status. Weighed against how
  //    much content came back: a page can carry a vendor's challenge script, or a
  //    login button, while serving the whole article.
  for (const s of SIGNATURES) {
    const m = s.re.exec(sigBody);
    if (!m) continue;
    const upstream = m[1] ? ` (upstream ${m[1]})` : "";
    if (text.length >= SUBSTANTIAL_TEXT) {
      warnings.push(`saw "${m[0]}" but the page returned ${text.length} characters — treating as content`);
      break;
    }
    return fail(s.outcome, `${s.reason}${upstream}`);
  }

  // 3. Plausibility. A client-rendered page hands a plain fetch a shell; that is not a
  //    failure of the site, it is the wrong rung — so `empty` points at the browser.
  const floor = input.minText ?? DEFAULT_MIN_TEXT;
  if (text.length < floor) {
    return fail(
      "empty",
      `only ${text.length} characters of text — likely a shell that needs a browser`,
    );
  }

  // 4. Relevance. Last, and a WARNING only: it is the one check that can be wrong
  //    about a perfectly good page, so it must never be the thing that discards it.
  const missing = (input.wanted ?? []).filter(
    (w) => w.trim() && !text.toLowerCase().includes(w.trim().toLowerCase()),
  );
  if (missing.length > 0) {
    warnings.push(`expected but not found: ${missing.join(", ")}`);
  }

  return { ok: true, outcome: "ok", reason: "content returned", warnings, textLength: text.length };
}
