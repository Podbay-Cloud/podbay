import { redirect } from "next/navigation";
import SelfhostLanding from "./selfhost-landing";
import { editionOss, getCurrentUser } from "@/lib/session";
import { selfhostLandingMetadata } from "@/lib/selfhost-landing-metadata";

export const dynamic = "force-dynamic";

export const metadata = selfhostLandingMetadata("https://podbay.cloud/selfhost");

export default async function SelfhostPage() {
  if (editionOss()) redirect("/dashboard");
  const user = await getCurrentUser();
  return <SelfhostLanding user={user} />;
}
