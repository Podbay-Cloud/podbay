import type { Metadata } from "next";
import { headers } from "next/headers";
import AgentComputerLanding from "./landing-agent-computer";
import AgentHomeLanding from "./landing-agent-home";
import LandingExperimentExposure from "./landing-experiment-client";
import OutcomesLanding from "./landing-outcomes";
import { redirect } from "next/navigation";
import { editionOss, getCurrentUser } from "@/lib/session";
import {
  ACTIVE_LANDING_EXPERIMENT,
  isVariantForExperiment,
  type LandingVariant,
} from "@/lib/landing-experiment-config";
import { getExperimentRuntimeSafe } from "@/lib/landing-experiment-store";

export const dynamic = "force-dynamic";

const landingTitle = "Podbay — Give Claude a real home in the cloud";
const landingDescription =
  "A Podbay pod is a private cloud VM with Claude Code, your project, and tools inside—always on, reachable anywhere, using your existing Claude subscription.";

export const metadata: Metadata = {
  title: landingTitle,
  description: landingDescription,
  alternates: { canonical: "https://podbay.cloud/" },
  openGraph: {
    title: landingTitle,
    description: landingDescription,
    url: "https://podbay.cloud",
    siteName: "Podbay",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: landingTitle,
    description: landingDescription,
  },
};

async function assignedVariant(): Promise<LandingVariant> {
  const definition = ACTIVE_LANDING_EXPERIMENT;
  const requestHeaders = await headers();
  const requested = requestHeaders.get(definition.requestHeaders.variant);
  const assigned = isVariantForExperiment(definition, requested)
    ? requested
    : definition.fallbackVariant;
  const runtime = await getExperimentRuntimeSafe();
  if (runtime.status === "stopped") {
    return runtime.pinnedVariant ?? definition.fallbackVariant;
  }
  return definition.deliveryMode === "measured" ? assigned : definition.validationVariant;
}

export default async function Home() {
  // Self-host is single-tenant with no marketing surface — the root IS the app.
  if (editionOss()) redirect("/dashboard");
  const [variant, user] = await Promise.all([assignedVariant(), getCurrentUser()]);
  const landing = variant === "agent-home"
    ? <AgentHomeLanding user={user} />
    : variant === "agent-computer"
      ? <AgentComputerLanding user={user} />
      : <OutcomesLanding user={user} />;
  return (
    <>
      <LandingExperimentExposure />
      {landing}
    </>
  );
}
