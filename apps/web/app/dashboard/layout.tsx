import { requireApprovedUser } from "@/lib/access";
import { editionOss } from "@/lib/session";
import DashboardShell, { type NavItem } from "@/components/dashboard-shell";
import { linkCurrentLandingAttribution } from "@/lib/landing-experiment-attribution";
import { supportIdentityHash } from "@/lib/support-identity";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Pods", icon: "LayoutGrid", exact: true },
  { href: "/dashboard/environments", label: "Environments", icon: "Boxes" },
  { href: "/dashboard/settings", label: "Settings", icon: "Settings" },
];

/**
 * Dashboard shell: a sidebar (logo, nav, bottom user menu) around the page
 * content. Fetches the user here so the sidebar persists across dashboard
 * routes without each page re-rendering it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireApprovedUser();
  // Cloud marketing attribution — no place in a single-tenant self-host install (and it
  // hits landing-experiment tables that aren't part of the OSS surface).
  if (!editionOss()) await linkCurrentLandingAttribution(user.id);
  return (
    <DashboardShell
      userName={user.name}
      userId={user.id}
      supportIdentityHash={supportIdentityHash(user.id) ?? undefined}
      nav={NAV}
    >
      {children}
    </DashboardShell>
  );
}
