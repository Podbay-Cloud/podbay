/**
 * Copy shared by the owner cockpit and the admin drill-in.
 *
 * Shared rather than duplicated because these strings describe CONSEQUENCES, and
 * two wordings of one consequence is how an owner and an operator end up with
 * different ideas of what a button does.
 */

/** Shown before suspend/update/resize. All recreate or stop the pod, but the home volume (incl.
 * ~/work) is REATTACHED, so files persist and the agent resumes its session — the only real cost is
 * that a running task stops mid-step. Say that calmly and accurately (the old copy claimed "work can
 * be lost", which is false for a volumed pod and needlessly scared owners off applying fixes). */
export const SESSION_INTERRUPT_WARNING =
  "Your files are kept and the agent resumes where it left off — a running task is interrupted.";
