import type { Metadata } from "next";
import AgentComputerLanding from "@/app/landing-agent-computer";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Landing preview: agent computer",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://podbay.cloud/" },
};

export default async function AgentComputerPreview() {
  return <AgentComputerLanding user={await getCurrentUser()} />;
}
