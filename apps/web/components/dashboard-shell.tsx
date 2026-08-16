"use client";

import { useState, useEffect } from "react";
import posthog from "posthog-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Boxes, Settings, UserCheck, Users, ArrowLeft, Menu, HardDrive, Sparkles, ChartNoAxesCombined, Globe, Radio, TriangleAlert } from "lucide-react";
import UserMenu from "@/components/user-menu";
import { cn } from "@/lib/utils";

/**
 * Icons live here (a client component) and are referenced by name, because a
 * Server Component layout can't pass a function/component across the boundary.
 * Add a nav icon here, then reference it by key from a layout's NavItem.
 */
const ICONS = { LayoutGrid, Boxes, Settings, UserCheck, Users, ArrowLeft, HardDrive, Sparkles, ChartNoAxesCombined, Globe, Radio, TriangleAlert } as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Match the path exactly instead of by prefix (for index routes like /admin). */
  exact?: boolean;
}

/**
 * Sidebar shell — desktop: a fixed left rail; mobile: a top bar with a
 * slide-in drawer. Nav only; account actions live in the bottom user menu.
 * The nav items and home link are passed in so both the user dashboard and the
 * backoffice render the same chrome with their own menus.
 */
export default function DashboardShell({
  userName,
  userId,
  supportIdentityHash,
  nav,
  homeHref = "/dashboard",
  children,
}: {
  userName: string;
  userId?: string;
  /** Server-computed HMAC of userId for PostHog Support verified-identity mode. Absent
   * until POSTHOG_SUPPORT_SECRET is set; the widget then runs unverified (per-browser). */
  supportIdentityHash?: string;
  nav: NavItem[];
  homeHref?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (userId) {
      posthog.identify(userId, { name: userName });
      // Verified identity for PostHog Support — the hash proves this distinct_id so the
      // user's support tickets follow them across browsers/devices. The secret stays on
      // the server; only the hash reaches here. No-op until POSTHOG_SUPPORT_SECRET is set.
      if (supportIdentityHash) posthog.setIdentity(userId, supportIdentityHash);
    }
  }, [userId, userName, supportIdentityHash]);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const brand = (
    <Link
      className="inline-flex items-center gap-2.5"
      href={homeHref}
      onClick={() => setDrawer(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="block h-[30px] w-auto" src="/podbay-mark.svg" alt="Podbay" />
      <span className="text-xl font-bold tracking-tight">
        <span className="text-[var(--accent-light)]">pod</span>
        <span className="text-primary">bay</span>
      </span>
    </Link>
  );

  const navMenu = (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-testid="nav-link"
            aria-current={active ? "page" : undefined}
            onClick={() => setDrawer(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-secondary font-medium text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-dvh">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-[60px] items-center gap-3 border-b border-border bg-card px-3 md:hidden">
        <button
          className="grid size-10 place-items-center rounded-lg border border-border"
          aria-label="Menu"
          aria-expanded={drawer}
          onClick={() => setDrawer((d) => !d)}
        >
          <Menu className="size-4.5" />
        </button>
        {brand}
      </header>

      {/* Backdrop for the mobile drawer */}
      {drawer && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setDrawer(false)}
        />
      )}

      <aside
        data-testid="sidebar"
        data-drawer={drawer ? "open" : "closed"}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[264px] -translate-x-full flex-col border-r border-border bg-card p-4 transition-transform md:static md:translate-x-0",
          drawer && "translate-x-0",
        )}
      >
        <div className="px-2 py-2.5">{brand}</div>
        <div className="mt-4 flex-1">{navMenu}</div>
        <div className="border-t border-border pt-3">
          <UserMenu userName={userName} />
        </div>
      </aside>

      {/* The only scroll container; pages render into DashboardPage inside it. */}
      <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-20 pt-[76px] sm:px-8 md:pt-7">
        {children}
      </main>
    </div>
  );
}
