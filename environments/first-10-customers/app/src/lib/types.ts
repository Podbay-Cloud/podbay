export const STATUSES = ["new", "contacted", "replied", "conversation", "won", "lost"] as const;
export type Status = (typeof STATUSES)[number];

export interface Message {
  id: string;
  at: string; // ISO
  channel?: string; // email / DM / reddit / …
  body: string;
}

/** How you can reach a lead. Deliberately a TYPED field, not prose in fitNotes:
 * a contact is something you click, filter and export, so it belongs in the schema.
 * (Dogfood find 2026-07-29 — research had captured every channel, but buried it in
 * free text, so the UI made the founder dig for it.) */
export type ContactType =
  | "email"
  | "website"
  | "x"
  | "github"
  | "linkedin"
  | "bluesky"
  | "reddit"
  | "indiehackers"
  | "hackernews"
  | "other";

export interface Contact {
  type: ContactType;
  /** What to show: "rob@example.com", "@reebz", "example.com". */
  label: string;
  /** The href — `mailto:…` or `https://…`. Email hrefs get the draft prefilled. */
  url: string;
  /** The channel to try FIRST (rendered filled; the rest outlined). */
  primary?: boolean;
  /** Caveat worth seeing before you click: "verify handle", "check the thread is
   * live (automod)", "invites contact". Warn-ish notes render amber. */
  note?: string;
}

export interface Lead {
  id: string;
  name: string;
  handle?: string; // @handle / company
  source?: string; // where they came from
  fitNotes?: string; // why they match the ICP
  status: Status;
  nextAction?: string;
  nextActionDate?: string; // ISO date
  contacts?: Contact[]; // structured, clickable ways to reach them
  createdAt: string; // ISO
  messages: Message[];
}
