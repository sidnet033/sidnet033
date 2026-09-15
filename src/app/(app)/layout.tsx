import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  return (
    <AppShell
      email={current?.email ?? null}
      fullName={current?.profile?.full_name ?? null}
      isAdmin={isAdmin}
    >
      {children}
    </AppShell>
  );
}
