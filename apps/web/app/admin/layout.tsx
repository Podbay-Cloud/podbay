import type { Metadata } from "next";
import { requireAdmin } from "@/lib/access";
import DashboardShell, { type NavItem } from "@/components/dashboard-shell";

// Admin pages read "<Page> · Admin · Podbay"; the bare /admin page uses the default.
export const metadata: Metadata = {
  title: { default: "Admin · Podbay", template: "%s · Admin · Podbay" },
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Access requests", icon: "UserCheck", exact: true },
  { href: "/admin/users", label: "Users", icon: "Users" },
  { href: "/admin/pods", label: "Pods", icon: "LayoutGrid" },
  { href: "/admin/incidents", label: "Incidents", icon: "TriangleAlert" },
  { href: "/admin/boxes", label: "Boxes", icon: "Boxes" },
  { href: "/admin/images", label: "Images", icon: "HardDrive" },
  { href: "/admin/skills", label: "Skills", icon: "Sparkles" },
  { href: "/admin/fetch-memory", label: "Fetch memory", icon: "Globe" },
  { href: "/admin/relay", label: "Relays", icon: "Radio" },
  { href: "/admin/experiments", label: "Experiments", icon: "ChartNoAxesCombined" },
  { href: "/dashboard", label: "Back to app", icon: "ArrowLeft" },
];

/**
 * Backoffice shell — the same sidebar chrome as the user dashboard, but gated
 * to admins and carrying the admin menu. Auth is enforced here so every
 * /admin/* route is protected by the layout, not page-by-page.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <DashboardShell userName={user.name} nav={NAV} homeHref="/admin">
      {children}
    </DashboardShell>
  );
}
