import Link from "next/link";
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#154b91",
};

// Phone-friendly, read-only views: projects list and project summary.
export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-surface-container-low text-on-surface">
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-surface-container-high bg-surface-container-lowest px-4">
        <Link href="/m" className="text-[15px] font-bold text-primary">
          TrueQuote
        </Link>
        <Link
          href="/?desktop=1"
          className="text-[12px] text-secondary underline"
        >
          Desktop site
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">{children}</main>
    </div>
  );
}
