/**
 * T3 enable-progress state machine (client side).
 *
 * The cockpit polls `t3Progress` while enabling T3 Code. Deciding what to do on each poll used to be
 * inline in a `useEffect`, and it got the COMPLETION case wrong: it treated `startedAt` (the durable
 * `t3Since`) as the "has the enable really started?" signal, then early-returned when it was null. But
 * `t3Since` is null in TWO different situations — before the enable is recorded AND after it finishes
 * (the row clears `t3Since` at `ready`). So a finished enable looked identical to a not-yet-started
 * one, the poll returned early, and the wizard froze on its first step ("Preparing the pod") forever
 * while the pod was actually fully in T3 control (t3ttt, 2026-08-25 — DB showed t3_control=t, stage
 * ready). Extracted here as a pure function so every edge case is unit-tested and can never regress.
 */
export type T3Progress = {
  active: boolean;
  stage: string | null;
  startedAt: string | null;
  inControl: boolean;
};

/**
 * - `wait`    — still provisioning (or the optimistic pre-start grace window): keep the enabling screen.
 * - `connect` — enable finished: send the owner into the T3 account-connect wizard.
 * - `done`    — enable finished but connect isn't needed (already connected / mid-connect): close + refresh.
 * - `error`   — enable failed: surface it and drop back to the cockpit.
 */
export type T3EnableAction = "wait" | "connect" | "done" | "error";

export function nextT3EnableAction(
  prog: T3Progress,
  ui: { t3Connected: boolean; connecting: boolean },
): T3EnableAction {
  // The durable row still marks an enable in flight → keep showing progress.
  if (prog.active) return "wait";

  // Not active. Disambiguate the terminal states by `inControl` + `stage`, NEVER by `startedAt`
  // alone: a FINISHED enable and a NOT-YET-STARTED one both have startedAt=null (t3Since is cleared
  // at `ready` and unset before the start is recorded). Conflating them is the freeze bug.
  if (prog.stage === "error") return "error";
  if (prog.inControl) {
    // Enable completed and T3 owns the pod. Guide to connect unless we're already there.
    return ui.t3Connected || ui.connecting ? "done" : "connect";
  }
  // Not active, not in control, not errored: the pre-start grace window (t3Since not written yet).
  if (!prog.startedAt) return "wait";
  // Started, not active, not in control, no error — an enable that ended without taking control
  // (unexpected). Don't hang: close the screen and let a refresh reconcile.
  return "done";
}
