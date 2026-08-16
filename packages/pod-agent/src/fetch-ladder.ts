import { verifyFetch, type FetchRung, type FetchOutcome, type VerifyResult } from "@podbay/shared";

/**
 * Climb the fetch ladder once, for one URL, and say what happened.
 *
 * Pure orchestration: every rung is injected, so the decision logic — which rungs to
 * try, in what order, when to stop, what to report, what to tell the caller when
 * nothing worked — is testable with no network and no browser. The IO lives at the
 * call site, which is thin by design.
 *
 * The reason this exists as a command rather than instructions in a skill: with
 * instructions, each agent hand-rolls the ladder differently and the verifier is
 * ADVISORY — the agent may or may not apply it. Here it is enforced, so a block page
 * cannot be returned as content no matter who is driving.
 */

export interface RungResponse {
  status: number;
  body: string;
  contentType?: string;
  finalUrl?: string;
}

export type Fetcher = () => Promise<RungResponse>;

export interface FetchPlanView {
  /** Rungs the fleet has seen work for this domain, most recent first. */
  good: FetchRung[];
  /** Rungs known to fail, with why. */
  bad: { rung: FetchRung; outcome: FetchOutcome }[];
}

export interface Attempt {
  rung: FetchRung;
  verdict: VerifyResult;
}

export interface LadderResult {
  ok: boolean;
  /** Present only when a rung produced VERIFIED content. */
  content?: string;
  rung?: FetchRung;
  attempts: Attempt[];
  /** Rungs skipped because memory says they fail here, and why. */
  skipped: { rung: FetchRung; outcome: FetchOutcome }[];
  /** Outcomes to write back, one per attempt. */
  reports: { rung: FetchRung; outcome: FetchOutcome }[];
  /** What a person or agent should do next. Present only on failure. */
  advice?: string;
}

/** Default order when memory says nothing: cheapest and most honest first. `api` is
 * absent on purpose — choosing an API is judgement about a specific source, not a
 * mechanical step, so it stays the agent's job. */
export const DEFAULT_ORDER: FetchRung[] = ["direct", "browser", "archive", "reader", "relay"];

/**
 * What to tell the caller when the ladder is exhausted. The outcomes point at
 * genuinely different next moves, so collapsing them into "fetch failed" throws away
 * the most useful thing we learned.
 */
export function adviseFrom(outcomes: FetchOutcome[]): string {
  if (outcomes.includes("login")) {
    return "the content needs a signed-in session — the relay can fetch it as you, once you allowlist the domain and sign in";
  }
  if (outcomes.includes("challenged")) {
    return "the source is behind bot management — do not try to defeat it; use its API if it has one, or the relay";
  }
  if (outcomes.includes("timeout")) {
    return "a rung timed out (slow or a hung relay browser) — this is transient, not a refusal; it will be retried";
  }
  if (outcomes.includes("blocked")) {
    return "the source refuses this network — no rung on the pod will change that; the relay fetches from your machine instead";
  }
  if (outcomes.includes("empty")) {
    return "nothing rendered — the page may need a browser we could not run, or it genuinely has no content";
  }
  return "no rung returned usable content";
}

export async function climb(opts: {
  url: string;
  plan?: FetchPlanView;
  fetchers: Partial<Record<FetchRung, Fetcher>>;
  wanted?: string[];
  minText?: number;
}): Promise<LadderResult> {
  const plan = opts.plan ?? { good: [], bad: [] };
  const badByRung = new Map(plan.bad.map((b) => [b.rung, b.outcome]));

  // Known-good rungs first — that ordering IS the saving the shared memory buys.
  // Everything else follows the default order, minus what memory says is hopeless.
  //
  // EXCEPT the relay: its ability to serve a domain is DYNAMIC — it depends on the
  // owner's live login + connection state, not on a past outcome. A single relay
  // timeout (the browser was slow/hung) used to record `relay:blocked` and then
  // SILENTLY skip the relay forever, so a domain the owner just logged into stayed
  // unreachable (live-caught 2026-08-03). So a bad memory NEVER skips the relay — it's
  // always retried when connected. A bounded relay timeout keeps that retry cheap.
  const skippable = (r: FetchRung) => r !== "relay";
  const known = plan.good.filter((r) => opts.fetchers[r]);
  const rest = DEFAULT_ORDER.filter(
    (r) => opts.fetchers[r] && !known.includes(r) && !(skippable(r) && badByRung.has(r)),
  );
  const order = [...known, ...rest];

  const skipped = DEFAULT_ORDER.filter((r) => opts.fetchers[r] && skippable(r) && badByRung.has(r)).map(
    (r) => ({ rung: r, outcome: badByRung.get(r)! }),
  );

  const attempts: Attempt[] = [];
  const reports: { rung: FetchRung; outcome: FetchOutcome }[] = [];

  for (const rung of order) {
    let res: RungResponse;
    try {
      res = await opts.fetchers[rung]!();
    } catch (err) {
      // A rung that throws did not work — recorded, not fatal. Distinguish a TIMEOUT
      // (slow/hung — transient, worth retrying) from a hard block, so the memory + the
      // dashboard say WHY, and a transient hiccup isn't mistaken for a refusal.
      const timedOut = /tim(e|ed)[ -]?out/i.test(String((err as Error)?.message ?? err));
      const outcome: FetchOutcome = timedOut ? "timeout" : "blocked";
      const verdict: VerifyResult = {
        ok: false,
        outcome,
        reason: timedOut ? "the rung did not answer in time" : "the rung could not be reached",
        warnings: [],
        textLength: 0,
      };
      attempts.push({ rung, verdict });
      reports.push({ rung, outcome });
      continue;
    }

    const verdict = verifyFetch({
      rung,
      status: res.status,
      body: res.body,
      contentType: res.contentType,
      finalUrl: res.finalUrl,
      wanted: opts.wanted,
      minText: opts.minText,
    });
    attempts.push({ rung, verdict });
    reports.push({ rung, outcome: verdict.outcome });

    if (verdict.ok) {
      return { ok: true, content: res.body, rung, attempts, skipped, reports };
    }
  }

  return {
    ok: false,
    attempts,
    skipped,
    reports,
    // Skipped rungs count toward the advice: if memory already knows the source
    // refuses this network, that is the answer even though we did not re-prove it.
    advice: adviseFrom([...attempts.map((a) => a.verdict.outcome), ...skipped.map((s) => s.outcome)]),
  };
}
