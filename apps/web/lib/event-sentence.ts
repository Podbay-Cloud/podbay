export interface TimelineEventLike {
  type: string;
  meta: Record<string, unknown> | null;
}

const short = (v: unknown): string =>
  typeof v === "string" && /^[0-9a-f]{16,}$/i.test(v) ? v.slice(0, 12) : String(v ?? "");

const agent = (v: unknown): string =>
  v === "codex" ? "Codex" : v === "claude-code" ? "Claude" : String(v ?? "an agent");

/**
 * One sentence a person can act on, from an event's type and meta.
 *
 * The timeline used to print the raw type ("update_stage") beside a list of meta
 * KEYS ("stage, agent") — which told a reader that data exists, not what happened.
 * A log nobody can read is a log nobody reads, and this one is the first place we
 * look when a pod misbehaves.
 *
 * Unknown types fall back to a de-underscored type rather than vanishing: a new
 * event should read awkwardly, never invisibly.
 */
export function eventSentence(e: TimelineEventLike): string {
  const m = e.meta ?? {};
  switch (e.type) {
    case "created":
      return `Pod created${m.environmentName ? ` from ${m.environmentName}` : ""}`;
    case "running":
      return m.reason === "reconciled" ? "Back online after a restart" : "Started running";
    case "sleeping": // legacy alias for "suspended" (pre-2026-08-02 rename)
    case "suspended":
      // A reconciled sleep is a platform restart observed, NOT the owner suspending.
      return m.reason === "reconciled"
        ? "Restarted (update or reboot)"
        : m.reason === "idle"
          ? "Running"
          : "Suspended";
    case "destroyed":
      return "Pod deleted";
    case "updated":
      return `Image changed${m.from ? ` from ${short(m.from)}` : ""}${m.to ? ` to ${short(m.to)}` : ""}`;
    case "update_started":
      return `Update started${m.to ? ` → ${short(m.to)}` : ""}`;
    case "update_stage":
      return `Updating: ${String(m.stage ?? "in progress")}`;
    case "update_failed":
      return `Update failed${m.error ? ` — ${String(m.error)}` : ""}`;
    case "resize_started":
      return `Resizing${m.size ? ` to ${String(m.size)}` : ""} — the pod restarts`;
    case "resized":
      return `Resized${m.size ? ` to ${String(m.size)}` : ""}`;
    case "resize_failed":
      return `Resize failed${m.error ? ` — ${String(m.error)}` : ""}`;
    case "error":
      return `Something went wrong${m.error ? ` — ${String(m.error)}` : ""}`;
    case "agent_added":
      return `${agent(m.agent)} added to this pod`;
    case "codex_rc_toggled":
      return `Codex remote control turned ${m.on ? "on" : "off"}`;
    case "claude_settings_changed": {
      const keys = Array.isArray(m.keys) ? m.keys : [];
      return keys.length ? `Claude settings updated (${keys.join(", ")})` : "Claude settings updated";
    }
    case "pod_repaired": {
      if (m.by === "doctor") {
        const fixed = Array.isArray(m.fixed) ? m.fixed : [];
        return `Doctor repaired ${fixed.length ? fixed.join(", ") : "an issue"}`;
      }
      const target = typeof m.target === "string" ? m.target : "";
      return target === "session"
        ? "The pod's session was restarted automatically"
        : `${agent(target)} was restarted automatically`;
    }
    case "repair_gave_up":
      return `Automatic repair gave up on ${agent(m.target)}`;
    case "secret_revealed":
      return m.key ? `Viewed ${String(m.key)}` : "Viewed a secret";
    case "secrets_exported":
      return m.count ? `Exported ${String(m.count)} secret${m.count === 1 ? "" : "s"}` : "Exported secrets";
    case "admin_action": {
      // Stored actions are a mix of bare verbs ("suspend") and phrases ("change the
      // pod's image"). Past-tense the verbs so the line reads as a sentence rather
      // than a log key: "Podbay suspend" is not something a person would write.
      const raw = String(m.action ?? "changed something");
      const past: Record<string, string> = {
        suspend: "suspended this pod",
        resume: "resumed this pod",
        delete: "deleted this pod",
      };
      const phrase =
        past[raw] ??
        raw
          .replace(/^change /, "changed ")
          .replace(/^run /, "ran ")
          .replace(/^reinstall /, "reinstalled ");
      return `Podbay ${phrase}`;
    }
    default:
      // Readable-ish rather than raw: "some_new_event" → "Some new event".
      return e.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}
