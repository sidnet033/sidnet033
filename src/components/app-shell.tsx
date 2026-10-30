"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: "dashboard", activeMatch: (p: string) => p === "/" },
  { href: "/", label: "Costing", icon: "payments", activeMatch: (p: string) => p.startsWith("/revisions") },
  { href: "/item-master", label: "Item Master", icon: "inventory_2", activeMatch: (p: string) => p.startsWith("/item-master") },
  { href: "/feeders", label: "Feeder Master", icon: "alt_route", activeMatch: (p: string) => p.startsWith("/feeders") },
  { href: "/how-it-works", label: "How it works", icon: "menu_book", activeMatch: (p: string) => p.startsWith("/how-it-works") },
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [profileMenuOpen]);

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

  // Top bar with the modules as tabs (active one underlined), profile menu
  // on the right; pages render below it at full width.
  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-50 flex h-[52px] select-none items-stretch gap-space-xl border-b border-surface-container-high bg-surface-container-lowest px-margin-lg shadow-xs">
        <Link href="/" className="flex items-center gap-space-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-[13px] font-black text-on-primary shadow-sm">AQ</span>
          <span className="flex flex-col leading-none">
            <span className="text-[16px] font-black tracking-tight text-on-surface">AmpQuote</span>
            <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">LV Estimator</span>
          </span>
        </Link>
        <nav aria-label="Modules" className="flex min-w-0 flex-1 items-stretch gap-space-2xs overflow-x-auto">
          {links.map((link) => {
            const active = link.activeMatch(pathname);
            return (
              <Link
                key={link.label}
                href={link.href}
                className={`flex shrink-0 items-center gap-1.5 border-b-[3px] px-space-md pt-[3px] text-[13px] transition-colors ${
                  active ? "border-primary font-bold text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon name={link.icon} size={16} />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div ref={profileMenuRef} className="relative flex items-center">
          <button
            onClick={() => setProfileMenuOpen((v) => !v)}
            title={displayName}
            aria-label="Profile menu"
            className="flex items-center gap-space-sm rounded-lg px-space-xs py-space-2xs text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-[12px] font-bold text-primary">
              {initials(displayName)}
            </span>
            <span className="hidden max-w-40 truncate text-[13px] text-on-surface md:inline">{displayName}</span>
            <Icon name="expand_more" size={16} />
          </button>
          {profileMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-60 rounded-xl border border-surface-container-high bg-surface-container-lowest p-2 shadow-lg">
              <p className="truncate px-space-xs pt-space-2xs text-[13px] font-bold text-on-surface">{displayName}</p>
              {email && <p className="truncate px-space-xs pb-space-xs text-[11px] text-on-surface-variant">{email}</p>}
              <button
                onClick={signOut}
                className="flex w-full items-center gap-space-xs rounded-lg px-space-xs py-space-xs text-left text-[13px] text-on-surface hover:bg-surface-container-low"
              >
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="min-h-[calc(100vh-52px)]">{children}</main>
    </div>
  );
}
