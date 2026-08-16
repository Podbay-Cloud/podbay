/**
 * Copy shared by the owner cockpit and the admin drill-in.
 *
 * Shared rather than duplicated because these strings describe CONSEQUENCES, and
 * two wordings of one consequence is how an owner and an operator end up with
 * different ideas of what a button does.
 */

/** Shown before suspend and before update. Both restart the pod, so an agent
 * mid-task is killed where it stands: the point is that "your files are kept" is
 * NOT the same as "your work in progress is kept". Deliberately short — a warning
 * nobody finishes reading is not a warning. */
export const SESSION_INTERRUPT_WARNING =
  "Stops any running agent session. Work in progress that isn't saved or committed can be lost — check the terminal first.";
