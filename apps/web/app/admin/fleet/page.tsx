import { redirect } from "next/navigation";

/** The fleet view split into two focused pages: the pods table lives at
 * /admin/pods and box capacity/economics at /admin/boxes. Keep this route alive
 * (old links, bookmarks) but send it to the pods table. */
export const metadata = { title: "Fleet" };
// Like every other /admin page: never prerender. A static build of this page runs the admin
// LAYOUT (requireAdmin → DB) at build time, which breaks any build without a reachable DB
// (bit the PGlite spike and the self-host image build alike).
export const dynamic = "force-dynamic";

export default function FleetPage() {
  redirect("/admin/pods");
}
