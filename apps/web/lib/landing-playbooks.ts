/** A playbook's launch readiness. "Pilot" grays the card out ("Pilot in progress"); "Ready"
 * makes it launchable. Kept a union (not collapsed to the current values) so a future pilot
 * playbook still type-checks against the Pilot branch. */
export type PlaybookReadiness = "Ready" | "Pilot";

export const LANDING_PLAYBOOKS = {
  "byo-project": {
    title: "BYO Project",
    kind: "workspace",
    readiness: "Ready" as PlaybookReadiness,
    image: "/landing/repo-onboard.webp",
    imageAlt: "Concept preview of an imported project map and verified development checklist",
    accent: "amber",
    proof: "Repo orientation · verified commands · testing and review skills",
    outcomeDescription:
      "Bring your GitHub repo. The agent maps the codebase, learns its conventions, and gets the test loop running before it changes anything.",
    computerDescription:
      "Bring an existing GitHub project. The agent maps the codebase, discovers its conventions, and gets the real test loop running before it changes anything.",
  },
  "doc-qa": {
    title: "Ask Your Docs",
    kind: "playbook",
    readiness: "Ready" as PlaybookReadiness,
    image: "/landing/knowledge-bot.webp",
    imageAlt: "Concept preview of a document-grounded assistant with citations",
    accent: "violet",
    proof: "Public assistant · owner console · grounded citations",
    outcomeDescription:
      "Turn your documents into a public chatbot that answers from them, with citations. The app uses a separate Anthropic API key you provide.",
    computerDescription:
      "Upload documents and shape a public assistant that answers from them with citations. The app uses a separate Anthropic API key you provide.",
  },
  "first-10-customers": {
    title: "First 10 Customers",
    kind: "playbook",
    readiness: "Ready" as PlaybookReadiness,
    image: "/landing/client-portal.webp",
    imageAlt: "Concept preview of a working customer pipeline dashboard",
    accent: "blue",
    proof: "Campaign page · private CRM · growth workflow",
    outcomeDescription:
      "Sharpen your offer, build the campaign page, draft personalized outreach, and track the learning loop in a built-in CRM.",
    computerDescription:
      "A guided growth workspace that sharpens the offer, builds the campaign page, drafts outreach, and keeps the learning loop in one persistent pipeline.",
  },
  "morning-ops-robot": {
    title: "Morning Ops Robot",
    kind: "playbook",
    readiness: "Ready" as PlaybookReadiness,
    image: "/landing/morning-brief.webp",
    imageAlt: "Concept preview of a scheduled operations brief",
    accent: "coral",
    proof: "Scheduled jobs · runs · alerts · daily digest",
    outcomeDescription:
      "Set up recurring checks and routine work, then get a morning brief of what changed and what needs your attention.",
    computerDescription:
      "An operations workspace for recurring checks and routine work. It briefs you on what changed and surfaces urgent findings. Live-pod dogfood is in progress.",
  },
} as const;

export type LandingPlaybookId = keyof typeof LANDING_PLAYBOOKS;

export function isLandingPlaybook(value: string): value is LandingPlaybookId {
  return value in LANDING_PLAYBOOKS;
}
