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
  { href: "/feeders", label: "Feeder Master", icon: "schema", activeMatch: (p: string) => p.startsWith("/feeders") },
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
  const [search, setSearch] = useState("");
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
    ? [...NAV_LINKS, { href: "/admin", label: "Admin Space", icon: "admin_panel_settings", activeMatch: (p: string) => p.startsWith("/admin") }]
    : NAV_LINKS;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    router.push(`/item-master?q=${encodeURIComponent(search.trim())}`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200/90 bg-white px-5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <Icon name="bolt" size={20} className="text-slate-700" />
            <span className="font-display text-sm font-semibold tracking-tight">AmpQuote LV</span>
          </div>
          <form onSubmit={handleSearch} className="relative hidden items-center sm:flex">
            <Icon name="search" size={17} className="absolute left-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item master..."
              className="w-72 rounded-md border border-slate-200 bg-slate-50 py-1 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 transition-all focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-300"
              type="text"
            />
          </form>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={signOut}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            Sign out
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 font-display text-xs font-medium text-white ring-1 ring-slate-200">
            {initials(displayName)}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1720px] flex-1">
        <aside
          className={`flex shrink-0 flex-col overflow-y-auto border-r border-slate-200/90 bg-white/60 transition-all ${
            collapsed ? "w-16 p-3" : "w-72 p-6 xl:w-80"
          }`}
        >
          <nav className="space-y-1">
            <div className={`mb-2 flex items-center px-2 ${collapsed ? "justify-center" : "justify-between"}`}>
              {!collapsed && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Navigation</span>
              )}
              <button
                onClick={toggleCollapsed}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Icon name={collapsed ? "chevron_right" : "chevron_left"} size={16} />
              </button>
            </div>
            {links.map((link) => {
              const active = link.activeMatch(pathname);
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  title={collapsed ? link.label : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                    collapsed ? "justify-center" : ""
                  } ${active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}
                >
                  <Icon name={link.icon} size={18} className={active ? "text-blue-600" : "text-slate-500"} />
                  {!collapsed && <span className={active ? "font-semibold" : ""}>{link.label}</span>}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 bg-white">{children}</main>
      </div>
    </div>
  );
}
