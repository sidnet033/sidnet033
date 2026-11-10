import Link from "next/link";
import type { Viewport } from "next";
import { getCurrentUser } from "@/lib/auth";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#154b91",
};

// Phone-friendly, read-only views: projects list and project summary.
export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const current = await getCurrentUser();
  const name = current?.profile?.full_name || current?.email || "?";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div className="min-h-dvh bg-surface-container-low text-on-surface">
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-surface-container-high bg-surface-container-lowest px-4">
        <Link href="/m" className="text-[15px] font-bold text-primary">
          TrueQuote
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/?desktop=1"
            className="text-[12px] text-secondary underline"
          >
            Desktop site
          </Link>
          <Link
            href="/m/profile"
            aria-label="My profile"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-on-primary"
          >
            {initials}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">{children}</main>
    </div>
  );
}
