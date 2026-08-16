import type { MetricSample } from "@podbay/shared";

/**
 * How much of a pod's awake time its agent was actually WORKING.
 *
 * Derived from the metric samples we already collect — each carries the agent's
 * own reported state — so this costs nothing new to gather. It answers the
 * question uptime cannot: a pod can be up for ten hours and have done nothing,
 * and "awake 10h" reads like activity when it is really just billing.
 *
 * The shares are weighted by TIME, not by sample count. That distinction became
 * load-bearing when history went tiered: a sample from the hourly tier stands for
 * 60× the time of a sample from the minute tier, so counting samples would let a
 * recent busy minute outweigh a quiet hour. On a 30-day view the last 24h supplies
 * a third of the samples while covering 3% of the span.
 *
 * `busy` and `shell` are both work — the agent thinking vs. the agent running a
 * command — and are reported apart because "it's been shelling out for an hour" and
 * "it's been thinking for an hour" mean different things when you're debugging.
 * `waiting` means waiting on the USER, which is neither working nor idle; counting
 * it as either would flatter or libel the pod.
 */
export interface ActivityShare {
  /** Samples that carried a usable state. 0 ⇒ nothing to say. */
  samples: number;
  /** Time those samples stand for, in ms. */
  coveredMs: number;
  busyPct: number;
  shellPct: number;
  waitingPct: number;
  idlePct: number;
  /** busy + shell — the agent doing something, either way. */
  activePct: number;
  /** The most recent state we saw, or null when unknown. */
  latest: string | null;
}

/**
 * What one sample stands for: the distance to the NEXT sample, which is the
 * resolution of whatever tier it came from. The final sample has no successor, so
 * it inherits the previous step rather than being dropped or assumed to be one
 * minute wide.
 *
 * A gap (pod suspended) is clamped: the pod recorded nothing across it, so we
 * neither credit nor blame that time — stretching the pre-suspend state across a
 * three-day gap would claim knowledge we don't have.
 */
function weights(series: MetricSample[]): number[] {
  if (series.length === 0) return [];
  if (series.length === 1) return [1];
  const steps = series.slice(1).map((s, i) => s.t - series[i].t);
  const typical = steps.slice().sort((a, b) => a - b)[Math.floor(steps.length / 2)] || 1;
  const cap = typical * 3;
  return [...steps.map((d) => Math.min(Math.max(d, 0), cap)), Math.min(steps[steps.length - 1], cap)];
}

export function activityShare(series: MetricSample[]): ActivityShare | null {
  const w = weights(series);
  const known = series
    .map((s, i) => ({ s, w: w[i] }))
    .filter((x) => typeof x.s.agentStatus === "string" && x.s.agentStatus);
  // No samples with a state is NOT "0% busy" — it is "we don't know", and saying
  // 0% would read as an idle pod rather than a silent one.
  if (known.length === 0) return null;

  // Degenerate series (every sample sharing a timestamp) carry no time to weight
  // by; fall back to one-vote-per-sample rather than dividing by zero and calling
  // a busy pod 0% busy.
  const flat = known.reduce((a, x) => a + x.w, 0) === 0;
  const weightOf = (x: { w: number }) => (flat ? 1 : x.w);
  const totalW = known.reduce((a, x) => a + weightOf(x), 0);
  const share = (state: string) =>
    known.filter((x) => x.s.agentStatus === state).reduce((a, x) => a + weightOf(x), 0) / totalW;

  const busy = share("busy");
  const shell = share("shell");
  const waiting = share("waiting");
  const pct = (n: number) => Math.round(n * 100);
  return {
    samples: known.length,
    coveredMs: totalW,
    busyPct: pct(busy),
    shellPct: pct(shell),
    waitingPct: pct(waiting),
    idlePct: pct(Math.max(0, 1 - busy - shell - waiting)),
    activePct: pct(busy + shell),
    latest: known[known.length - 1]?.s.agentStatus ?? null,
  };
}
