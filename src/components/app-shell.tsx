"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

type NavLink = { href: string; label: string; activeMatch: (p: string) => boolean };
type NavEntry = NavLink | { label: string; children: NavLink[] };

const NAV: NavEntry[] = [
  { href: "/", label: "Dashboard", activeMatch: (p) => p === "/" },
  { href: "/", label: "Costing", activeMatch: (p) => p.startsWith("/revisions") },
  {
    label: "Masters",
    children: [
      { href: "/item-master", label: "Item Master", activeMatch: (p) => p.startsWith("/item-master") },
      { href: "/feeders", label: "Feeder Master", activeMatch: (p) => p.startsWith("/feeders") },
    ],
  },
  { href: "/how-it-works", label: "How it works", activeMatch: (p) => p.startsWith("/how-it-works") },
];

const tabClass = (active: boolean) =>
  `flex shrink-0 items-center gap-1 border-b-[3px] px-space-md pt-[3px] text-[13px] transition-colors ${
    active ? "border-primary font-bold text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
  }`;

// A top-bar tab that opens a small menu of links (e.g. Masters).
function NavMenu({ label, items, pathname }: { label: string; items: NavLink[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const active = items.some((i) => i.activeMatch(pathname));
  return (
    <div ref={ref} className="relative flex">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={tabClass(active)}>
        {label}
        <Icon name="expand_more" size={16} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-surface-container-high bg-surface-container-lowest p-1.5 shadow-lg">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2 text-[13px] ${
                i.activeMatch(pathname) ? "bg-primary-fixed font-bold text-primary" : "text-on-surface hover:bg-surface-container-low"
              }`}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const links: NavEntry[] = isAdmin ? [...NAV, { href: "/admin", label: "Admin Space", activeMatch: (p: string) => p.startsWith("/admin") }] : NAV;

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
        <nav aria-label="Modules" className="flex min-w-0 flex-1 items-stretch gap-space-2xs">
          {links.map((link) =>
            "children" in link ? (
              <NavMenu key={link.label} label={link.label} items={link.children} pathname={pathname} />
            ) : (
              <Link key={link.label} href={link.href} className={tabClass(link.activeMatch(pathname))}>
                {link.label}
              </Link>
            )
          )}
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
