"use client";

import {
  AtSign,
  Briefcase,
  Code,
  ExternalLink,
  Globe,
  Hash,
  Mail,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { Contact, ContactType, Lead } from "@/lib/types";

/**
 * Reach-out rendering for a lead's structured contacts.
 *
 * Two things this exists to prevent, both learned by dogfooding (2026-07-29):
 *  1. contacts living as prose in a notes field — the founder then has to DIG for
 *     the way to contact someone, which is the one thing a CRM must never make you do;
 *  2. an email chip that opens an empty compose window — if we already wrote the
 *     draft, the mail app should open with it in place.
 *
 * NOTE ON ICONS: lucide has NO brand glyphs (no Github/Linkedin/X). Generic icons
 * carry the shape, the LABEL carries the meaning. Don't go hunting for brand icons.
 */
export const CONTACT_META: Record<ContactType, { label: string; Icon: LucideIcon }> = {
  email: { label: "Email", Icon: Mail },
  website: { label: "Website", Icon: Globe },
  x: { label: "X", Icon: AtSign },
  github: { label: "GitHub", Icon: Code },
  linkedin: { label: "LinkedIn", Icon: Briefcase },
  bluesky: { label: "Bluesky", Icon: MessageSquare },
  reddit: { label: "Reddit", Icon: MessageSquare },
  indiehackers: { label: "Indie Hackers", Icon: Hash },
  hackernews: { label: "HN", Icon: Hash },
  other: { label: "Link", Icon: ExternalLink },
};

/** Primary channel first — that's the one we recommend trying. */
export function orderedContacts(lead: Pick<Lead, "contacts">): Contact[] {
  return (lead.contacts ?? []).slice().sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
}

/** A note that should read as a caution rather than a hint. */
function isWarnNote(note?: string): boolean {
  return /verify|check|no public|skip|automod|least-bad|may be/i.test(note ?? "");
}

/**
 * Pull subject + body out of the most recent draft so an email chip opens the mail
 * client ready to send. Drafts are stored as "<marker line>\n\nSubject: …\n\n<body>".
 */
export function draftParts(lead: Lead): { subject?: string; body?: string } {
  const msg = lead.messages[lead.messages.length - 1];
  if (!msg) return {};
  let rest = msg.body.split("\n\n").slice(1).join("\n\n").trim(); // drop the marker line
  let subject: string | undefined;
  const m = rest.match(/^Subject:\s*(.*)\r?\n?/);
  if (m) {
    subject = m[1].trim();
    rest = rest.slice(m[0].length).trim();
  }
  return { subject, body: rest };
}

/**
 * Practical ceiling for a prefilled mailto. The spec sets no limit, but real
 * clients do — Gmail's web compose and some Outlook builds silently TRUNCATE or
 * drop a long body, which looks like "the prefill didn't work". Past this we keep
 * the subject, skip the body, and the UI offers copy-to-clipboard instead.
 */
export const MAILTO_BODY_LIMIT = 1800;

/** mailto: with the draft prefilled; other channels are their own URL. */
export function contactHref(contact: Contact, lead: Lead): string {
  if (contact.type !== "email") return contact.url;
  const { subject, body } = draftParts(lead);
  const parts: string[] = [];
  if (subject) parts.push("subject=" + encodeURIComponent(subject));
  if (body && encodeURIComponent(body).length <= MAILTO_BODY_LIMIT) {
    parts.push("body=" + encodeURIComponent(body));
  }
  return parts.length ? `${contact.url}?${parts.join("&")}` : contact.url;
}

/** True when the draft was too long to prefill — the UI says so instead of lying. */
export function bodyTooLongForMailto(lead: Lead): boolean {
  const { body } = draftParts(lead);
  return Boolean(body && encodeURIComponent(body).length > MAILTO_BODY_LIMIT);
}

/** Compact "Email · X · +2" summary for a table cell. */
export function contactSummary(lead: Pick<Lead, "contacts">): string[] {
  return orderedContacts(lead).map((c) => CONTACT_META[c.type].label);
}

/**
 * The "Reach out" panel: every channel as a clickable chip, primary filled and the
 * rest outlined, each opening in a new tab. Caveats render under their chip.
 */
export function ReachOut({ lead }: { lead: Lead }) {
  const contacts = orderedContacts(lead);
  const hasEmail = contacts.some((c) => c.type === "email");
  const truncated = hasEmail && bodyTooLongForMailto(lead);

  if (contacts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No public contact channel found — benched until one turns up.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {contacts.map((ct, i) => {
          const { label, Icon } = CONTACT_META[ct.type];
          const isEmail = ct.type === "email";
          const warn = isWarnNote(ct.note);
          return (
            <div key={`${ct.type}-${i}`} className="flex flex-col gap-1">
              <a
                href={contactHref(ct, lead)}
                // A mailto must NOT open a blank tab — let it hand off to the mail app.
                {...(isEmail ? {} : { target: "_blank" })}
                rel="noopener noreferrer"
                className={`${buttonVariants({ variant: ct.primary ? "default" : "outline", size: "sm" })} gap-1.5`}
              >
                <Icon className="size-3.5" />
                <span className="text-xs font-medium">{label}</span>
                <span className="text-xs opacity-70">· {ct.label}</span>
              </a>
              {ct.note && (
                <span
                  className={`max-w-56 text-[11px] leading-tight ${
                    warn ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
                  }`}
                >
                  {warn ? "⚠ " : ""}
                  {ct.note}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {hasEmail && (
        <p className="text-xs text-muted-foreground">
          {truncated
            ? "Email opens your mail app with the subject filled in — the draft is too long to prefill, so copy it from below."
            : "Email opens your mail app with the draft subject + body prefilled."}
        </p>
      )}
    </div>
  );
}
