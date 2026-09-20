"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: "dashboard", activeMatch: (p: string) => p === "/" },
  { href: "/", label: "Costing", icon: "payments", activeMatch: (p: string) => p.startsWith("/revisions") },
  { href: "/item-master", label: "Item Master", icon: "inventory_2", activeMatch: (p: string) => p.startsWith("/item-master") },
  { href: "/feeders", label: "Feeder Master", icon: "alt_route", activeMatch: (p: string) => p.startsWith("/feeders") },
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

export function AppShell({
  email,
  fullName,
  isAdmin,
  children,
}: {
  email: string | null;
  fullName: string | null;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("sidebar-collapsed") === "1";
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  const displayName = fullName || email || "User";
  const links = isAdmin
    ? [...NAV_LINKS, { href: "/admin", label: "Admin Space", icon: "verified_user", activeMatch: (p: string) => p.startsWith("/admin") }]
    : NAV_LINKS;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const sidebarWidth = collapsed ? "w-16" : "w-72";
  const contentOffset = collapsed ? "pl-16" : "pl-72";
  const headerOffset = collapsed ? "left-16" : "left-72";

  return (
    <div className="min-h-screen bg-surface">
      <aside className={`fixed left-0 top-0 z-50 flex h-full ${sidebarWidth} select-none flex-col justify-between bg-surface-container-lowest shadow-[0_1px_8px_rgba(0,0,0,0.04)] transition-all`}>
        <div className="flex flex-col">
          <div className="flex h-16 items-center gap-space-sm bg-surface-container-lowest px-space-md">
            {!collapsed && (
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm tracking-tight text-primary">AmpQuote</span>
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">LV Estimator CAD</span>
              </div>
            )}
            {collapsed && <span className="font-headline-sm text-headline-sm text-primary">AQ</span>}
          </div>
          <div className="flex flex-col gap-space-xs p-space-md">
            {!collapsed && <span className="px-space-xs font-label-sm text-label-sm uppercase tracking-wider text-secondary">Navigation</span>}
            <nav className="flex flex-col gap-space-2xs">
              {links.map((link) => {
                const active = link.activeMatch(pathname);
                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    title={collapsed ? link.label : undefined}
                    className={`flex items-center gap-space-sm rounded-lg px-space-sm py-space-xs transition-colors ${
                      collapsed ? "justify-center" : ""
                    } ${active ? "bg-primary-container font-medium text-on-primary-container" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"}`}
                  >
                    <Icon name={link.icon} size={18} />
                    {!collapsed && <span className="font-body-md text-body-md">{link.label}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        <div className="flex flex-col gap-space-xs bg-surface-container-lowest p-space-md">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex items-center gap-space-sm rounded-lg px-space-sm py-space-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface ${collapsed ? "justify-center" : ""}`}
          >
            <Icon name={collapsed ? "chevron_right" : "chevron_left"} size={18} />
            {!collapsed && <span className="font-body-md text-body-md">Collapse</span>}
          </button>
        </div>
      </aside>

      <header className={`fixed right-0 top-0 z-40 flex h-16 items-center justify-end gap-space-sm bg-surface-container-lowest/90 px-space-lg shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all ${headerOffset}`}>
        <button
          onClick={signOut}
          className="flex h-8 items-center gap-space-xs rounded-lg bg-surface-container-low px-space-sm font-body-md text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high"
        >
          <Icon name="logout" size={16} />
          Sign out
        </button>
        <div className="mx-space-xs h-6 w-px bg-surface-container-high" />
        <button
          disabled
          title="Notifications coming soon"
          className="rounded-lg p-space-xs text-secondary transition-colors hover:bg-surface-container-low hover:text-on-surface disabled:cursor-not-allowed"
        >
          <Icon name="notifications" size={20} />
        </button>
        <button
          disabled
          title="Dark mode coming soon"
          className="rounded-lg p-space-xs text-secondary transition-colors hover:bg-surface-container-low hover:text-on-surface disabled:cursor-not-allowed"
        >
          <Icon name="light_mode" size={20} />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-telemetry-md text-[12px] font-bold text-on-primary" title={displayName}>
          {initials(displayName)}
        </div>
      </header>

      <main className={`min-h-screen ${contentOffset} pt-16 transition-all`}>{children}</main>
    </div>
  );
}
