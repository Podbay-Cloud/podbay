import type { Metadata } from "next";
import OutcomesLanding from "@/app/landing-outcomes";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Landing preview: outcomes",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://podbay.cloud/" },
};

export default async function OutcomesPreview() {
  return <OutcomesLanding user={await getCurrentUser()} />;
}
