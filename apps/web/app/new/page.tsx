import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Legacy launch route. The marketplace now lives in-shell at
 * /dashboard/environments; redirect (preserving any ?env= preselection) so old
 * links, the landing CTA, and shareable env URLs keep working.
 */
export default async function NewPod({
  searchParams,
}: {
  searchParams: Promise<{ env?: string }>;
}) {
  const { env } = await searchParams;
  redirect(`/dashboard/environments${env ? `?env=${encodeURIComponent(env)}` : ""}`);
}
