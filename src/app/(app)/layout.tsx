import { NavBar } from "@/components/nav-bar";
import { getCurrentUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar email={current?.email ?? null} role={current?.profile?.role ?? null} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
