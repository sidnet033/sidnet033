"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/", label: "Projects" },
  { href: "/feeders", label: "Feeder Library" },
  { href: "/item-master", label: "Item Master" },
];

export function NavBar({ email, role }: { email: string | null; role: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-slate-900">LV Switchboard Quoting</span>
          <nav className="flex gap-4">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm ${
                  pathname === link.href
                    ? "font-medium text-slate-900"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>
            {email} {role ? `(${role})` : ""}
          </span>
          <button onClick={signOut} className="text-slate-500 underline hover:text-slate-700">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
