"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database";

export function AdminUserTable({
  initialProfiles,
  currentUserId,
}: {
  initialProfiles: Profile[];
  currentUserId: string;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const supabase = useMemo(() => createClient(), []);

  async function changeRole(id: string, role: "admin" | "sales") {
    if (id === currentUserId && role !== "admin") {
      if (!confirm("This will remove your own admin access. Continue?")) return;
    }
    setProfiles(profiles.map((p) => (p.id === id ? { ...p, role } : p)));
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) alert(error.message);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Name / email</th>
            <th className="px-4 py-2">Role</th>
            <th className="px-4 py-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="px-4 py-3 font-medium text-slate-900">
                {p.full_name || "—"}
                {p.id === currentUserId && <span className="ml-2 text-xs text-slate-400">(you)</span>}
              </td>
              <td className="px-4 py-3">
                <select
                  value={p.role}
                  onChange={(e) => changeRole(p.id, e.target.value as "admin" | "sales")}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="sales">Sales</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td className="px-4 py-3 text-slate-500">{new Date(p.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {profiles.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
