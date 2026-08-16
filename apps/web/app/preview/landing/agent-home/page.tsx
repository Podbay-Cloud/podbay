import type { Metadata } from "next";
import AgentHomeLanding from "@/app/landing-agent-home";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Landing preview: agent home",
  description: "A focused Podbay landing concept: a home your coding agent knows how to use.",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://podbay.cloud/" },
};

export default async function AgentHomePreview() {
  return <AgentHomeLanding user={await getCurrentUser()} />;
}
