export const LANDING_VARIANTS = ["outcomes", "agent-computer", "agent-home", "selfhost"] as const;
export type LandingVariant = (typeof LANDING_VARIANTS)[number];

export const LANDING_EVENT_TYPES = [
  "landing_exposure",
  "landing_primary_cta",
  "landing_example_select",
  "landing_starter_select",
  "landing_playbook_select",
  "signin_completed",
  "pod_created",
  "agent_connected",
  "first_project_opened",
] as const;
export type LandingExperimentEvent = (typeof LANDING_EVENT_TYPES)[number];
export type LandingDeliveryMode = "historical" | "validation" | "measured";
export type LandingControlType = "acquisition" | "homepage-promotion";

export interface LandingExperimentDefinition {
  id: string;
  label: string;
  hypothesis: string;
  controlType: LandingControlType;
  variants: readonly LandingVariant[];
  deliveryMode: LandingDeliveryMode;
  allocation: Readonly<Partial<Record<LandingVariant, number>>>;
  fallbackVariant: LandingVariant;
  validationVariant: LandingVariant;
  crawlerVariant: LandingVariant;
  primaryMetric: LandingExperimentEvent;
  activationMetrics: readonly LandingExperimentEvent[];
  guardrailMetric: LandingExperimentEvent;
  observationWindow: string;
  minimumExposuresPerVariant: number;
  baseline: string;
  retentionDays: number;
  narrativeFreeze: string;
  cookie: {
    visitor: string;
    variant: string;
    maxAgeSeconds: number;
  };
  requestHeaders: {
    visitor: string;
    variant: string;
    eligible: string;
  };
}

const common = {
  controlType: "acquisition" as const,
  primaryMetric: "signin_completed" as const,
  activationMetrics: ["pod_created", "agent_connected", "first_project_opened"] as const,
  guardrailMetric: "agent_connected" as const,
  retentionDays: 90,
  narrativeFreeze:
    "Material copy, proof, metric, allocation, or variant changes require a new experiment identifier.",
  requestHeaders: {
    visitor: "x-podbay-landing-visitor",
    variant: "x-podbay-landing-variant",
    eligible: "x-podbay-landing-eligible",
  },
} as const;

export const JULY_LANDING_EXPERIMENT = {
  ...common,
  id: "landing-positioning-2026-07",
  label: "Landing positioning: outcomes vs agent computer",
  hypothesis:
    "Visitors who already use coding agents will activate more often when Podbay is presented as the agent's always-on computer.",
  variants: ["outcomes", "agent-computer"],
  deliveryMode: "historical",
  allocation: { outcomes: 50, "agent-computer": 50 },
  fallbackVariant: "outcomes",
  validationVariant: "outcomes",
  crawlerVariant: "agent-computer",
  observationWindow: "Historical July A/A validation; no measured winner read.",
  minimumExposuresPerVariant: 100,
  baseline: "July data is retained as instrumentation validation, not an A/B result.",
  cookie: {
    visitor: "pb_landing_visitor",
    variant: "pb_landing_2026_07_variant",
    maxAgeSeconds: 60 * 60 * 24 * 90,
  },
} as const satisfies LandingExperimentDefinition;

const augustDeliveryMode: LandingDeliveryMode =
  process.env.PODBAY_LANDING_EXPERIMENT_MODE === "abc" ? "measured" : "validation";

export const AUGUST_LANDING_EXPERIMENT = {
  ...common,
  id: "landing-positioning-2026-08-agent-home",
  label: "Landing positioning: outcomes vs computer vs home",
  hypothesis:
    "Qualified coding-agent users will activate more often when Podbay is presented as a capable home the agent knows how to operate.",
  variants: ["outcomes", "agent-computer", "agent-home"],
  deliveryMode: augustDeliveryMode,
  allocation: { outcomes: 34, "agent-computer": 33, "agent-home": 33 },
  fallbackVariant: "outcomes",
  validationVariant: "outcomes",
  crawlerVariant: "agent-home",
  observationWindow:
    "Minimum 14 full measured days and 100 eligible exposures per variant; treat this as an operational floor, not automatic statistical proof.",
  minimumExposuresPerVariant: 100,
  baseline:
    "Establish the August sign-in and activation baseline during production A/A/A validation before enabling measured delivery.",
  cookie: {
    visitor: "pb_landing_visitor",
    variant: "pb_landing_2026_08_agent_home_variant",
    maxAgeSeconds: 60 * 60 * 24 * 90,
  },
} as const satisfies LandingExperimentDefinition;

// Decision (2026-08-08): "agent computer" became the sole landing in an A/A validation.
// This original definition is retained as historical so its assignments and events remain
// queryable after the workspace/playbook taxonomy copy received a new experiment id.
export const AGENT_COMPUTER_LANDING_2026_08 = {
  ...common,
  id: "landing-agent-computer-2026-08",
  label: "Landing: agent computer (historical sole-page A/A)",
  hypothesis:
    "Agent-computer is the chosen positioning; serve it to everyone and keep instrumentation live for the next test.",
  variants: ["agent-computer", "outcomes"],
  deliveryMode: "historical" as LandingDeliveryMode,
  allocation: { "agent-computer": 50, outcomes: 50 },
  fallbackVariant: "agent-computer",
  validationVariant: "agent-computer",
  crawlerVariant: "agent-computer",
  observationWindow:
    "A/A validation: 50/50 assignment, both arms served agent-computer; no measured winner is read.",
  minimumExposuresPerVariant: 100,
  baseline: "Agent-computer is the sole served landing; outcomes kept as the A/A arm but never shown.",
  cookie: {
    visitor: "pb_landing_visitor",
    variant: "pb_landing_agent_computer_variant",
    maxAgeSeconds: 60 * 60 * 24 * 90,
  },
} as const satisfies LandingExperimentDefinition;

// Workspace/playbook taxonomy changed material acquisition copy, so it received a distinct id and
// cookie rather than mixing new impressions with the historical sole-page validation. It became
// historical when the primary CTA changed from the computer frame to the real-home frame.
export const AGENT_COMPUTER_LANDING_TAXONOMY_2026_08 = {
  ...AGENT_COMPUTER_LANDING_2026_08,
  id: "landing-agent-computer-2026-08-taxonomy",
  label: "Landing: agent computer + start taxonomy (historical sole-page A/A)",
  deliveryMode: "historical" as LandingDeliveryMode,
  cookie: {
    visitor: "pb_landing_visitor",
    variant: "pb_landing_agent_computer_taxonomy_variant",
    maxAgeSeconds: 60 * 60 * 24 * 90,
  },
} as const satisfies LandingExperimentDefinition;

// The real-home CTA and explicit cloud-VM definition materially change the acquisition offer, so
// they start a fresh validation run while the page and allocation remain otherwise unchanged.
export const AGENT_COMPUTER_LANDING = {
  ...AGENT_COMPUTER_LANDING_TAXONOMY_2026_08,
  id: "landing-agent-computer-2026-08-real-home-cloud",
  label: "Landing: real home + cloud VM (sole page · A/A validation)",
  deliveryMode: "validation" as LandingDeliveryMode,
  cookie: {
    visitor: "pb_landing_visitor",
    variant: "pb_landing_agent_computer_real_home_variant",
    maxAgeSeconds: 60 * 60 * 24 * 90,
  },
} as const satisfies LandingExperimentDefinition;

// A manual, independently audited promotion control. It never enrolls visitors into the
// acquisition experiment: /selfhost is always available, while a pin makes that page the root.
export const SELFHOST_HOMEPAGE_CONTROL = {
  ...common,
  id: "homepage-selfhost-promotion-2026-08",
  label: "Homepage promotion: self-hosted AI admin",
  hypothesis:
    "Keep the self-host landing available at /selfhost and promote it to the homepage only when an administrator chooses to.",
  controlType: "homepage-promotion",
  variants: ["selfhost"],
  deliveryMode: "validation" as LandingDeliveryMode,
  allocation: { selfhost: 100 },
  fallbackVariant: "selfhost",
  validationVariant: "selfhost",
  crawlerVariant: "selfhost",
  observationWindow: "Manual promotion control; no visitor allocation or winner read.",
  minimumExposuresPerVariant: 1,
  baseline: "The current acquisition landing remains canonical until selfhost is pinned.",
  cookie: {
    visitor: "pb_landing_visitor",
    variant: "pb_homepage_selfhost_promotion",
    maxAgeSeconds: 60 * 60 * 24 * 90,
  },
} as const satisfies LandingExperimentDefinition;

export const LANDING_EXPERIMENTS = [
  JULY_LANDING_EXPERIMENT,
  AUGUST_LANDING_EXPERIMENT,
  AGENT_COMPUTER_LANDING_2026_08,
  AGENT_COMPUTER_LANDING_TAXONOMY_2026_08,
  AGENT_COMPUTER_LANDING,
  SELFHOST_HOMEPAGE_CONTROL,
] as const satisfies readonly LandingExperimentDefinition[];

export const ACTIVE_LANDING_EXPERIMENT = AGENT_COMPUTER_LANDING;
// Compatibility alias for call sites that only operate on the active acquisition experiment.
export const LANDING_EXPERIMENT = ACTIVE_LANDING_EXPERIMENT;

export function isMutableLandingDefinition(experimentId: string): boolean {
  return (
    experimentId === ACTIVE_LANDING_EXPERIMENT.id ||
    experimentId === SELFHOST_HOMEPAGE_CONTROL.id
  );
}

for (const definition of LANDING_EXPERIMENTS) {
  const allocation: Readonly<Partial<Record<LandingVariant, number>>> = definition.allocation;
  const total = definition.variants.reduce(
    (sum, variant) => sum + (allocation[variant] ?? 0),
    0,
  );
  if (total !== 100) throw new Error(`Landing allocation for ${definition.id} must total 100`);
}

export function getLandingExperimentDefinition(
  experimentId: string,
): LandingExperimentDefinition | null {
  return LANDING_EXPERIMENTS.find((definition) => definition.id === experimentId) ?? null;
}

export function isLandingVariant(value: unknown): value is LandingVariant {
  return typeof value === "string" && LANDING_VARIANTS.includes(value as LandingVariant);
}

export function isVariantForExperiment(
  definition: LandingExperimentDefinition,
  value: unknown,
): value is LandingVariant {
  return isLandingVariant(value) && definition.variants.includes(value);
}

export function isLandingEvent(value: unknown): value is LandingExperimentEvent {
  return (
    typeof value === "string" &&
    LANDING_EVENT_TYPES.includes(value as LandingExperimentEvent)
  );
}

export function isLandingVisitorId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
}

export function chooseLandingVariant(
  randomValue: number,
  definition: LandingExperimentDefinition = ACTIVE_LANDING_EXPERIMENT,
): LandingVariant {
  const bounded = Math.min(Math.max(randomValue, 0), 0.999999999999);
  let cumulative = 0;
  for (const variant of definition.variants) {
    cumulative += (definition.allocation[variant] ?? 0) / 100;
    if (bounded < cumulative) return variant;
  }
  return definition.variants.at(-1) ?? definition.fallbackVariant;
}

export function landingPreviewPath(variant: LandingVariant): string {
  if (variant === "selfhost") return "/selfhost";
  return `/preview/landing/${variant}`;
}

export function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|linkedinbot|twitterbot|whatsapp|discordbot/i.test(
    userAgent,
  );
}
