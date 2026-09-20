"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import type { Profile, Role } from "@/types/database";

type PendingChange = { role?: "admin" | "sales"; role_id?: string | null };

function StatusBadge({ profile }: { profile: Profile }) {
  if (profile.disabled) {
    return (
      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
        Disabled
      </span>
    );
  }
  if (profile.status === "active") {
    return (
      <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
        Active
      </span>
    );
  }
  return (
    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
      Invited
    </span>
  );
}

export function UserManagementSection({
  initialProfiles,
  roles,
  currentUserId,
}: {
  initialProfiles: Profile[];
  roles: Role[];
  currentUserId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [savedProfiles, setSavedProfiles] = useState(initialProfiles);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [saving, setSaving] = useState(false);

  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetSentId, setResetSentId] = useState<string | null>(null);
  const [resendId, setResendId] = useState<string | null>(null);
  const [resendSentId, setResendSentId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const dirty = Object.keys(pending).length > 0;

  function updateField(id: string, patch: PendingChange) {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setPending((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function cancelChanges() {
    setProfiles(savedProfiles);
    setPending({});
  }

  async function saveChanges() {
    setSaving(true);
    for (const [id, patch] of Object.entries(pending)) {
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) {
        alert(error.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setSavedProfiles(profiles);
    setPending({});
  }

  async function refreshProfiles() {
    const { data: fresh } = await supabase.from("profiles").select("*").order("created_at");
    setSavedProfiles((fresh ?? []) as Profile[]);
    setProfiles((fresh ?? []) as Profile[]);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    const res = await fetch("/api/admin/invite-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), fullName: inviteName.trim() || undefined }),
    });
    const body = await res.json();
    setInviteBusy(false);
    if (!res.ok) {
      setInviteError(body.error || "Could not send the invite.");
      return;
    }
    await refreshProfiles();
    setInviteEmail("");
    setInviteName("");
    setInviting(false);
  }

  async function handleResendInvite(profile: Profile) {
    if (!profile.email) {
      alert("This user has no email on file.");
      return;
    }
    setResendId(profile.id);
    const res = await fetch("/api/admin/invite-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: profile.email, fullName: profile.full_name || undefined }),
    });
    const body = await res.json();
    setResendId(null);
    if (!res.ok) {
      alert(body.error || "Could not resend the invite.");
      return;
    }
    setResendSentId(profile.id);
    setTimeout(() => setResendSentId(null), 4000);
  }

  async function handleResetPassword(profile: Profile) {
    if (!profile.email) {
      alert("This user has no email on file.");
      return;
    }
    setBusyId(profile.id);
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    setResetSentId(profile.id);
    setTimeout(() => setResetSentId(null), 4000);
  }

  async function handleToggleDisabled(profile: Profile) {
    const disabled = !profile.disabled;
    if (disabled && !confirm(`Disable ${profile.full_name || profile.email}? They won't be able to sign in until you re-enable them.`)) return;
    setStatusBusyId(profile.id);
    const res = await fetch("/api/admin/set-user-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: profile.id, disabled }),
    });
    const body = await res.json();
    setStatusBusyId(null);
    if (!res.ok) {
      alert(body.error || "Could not update this user's access.");
      return;
    }
    setSavedProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, disabled } : p)));
    setProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, disabled } : p)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-on-surface">Users</h2>
          <p className="text-xs text-secondary">
            The Admin/User role below is what actually controls access today. Custom roles (right column) are a
            management layer for the access matrix further down — see the note there.
          </p>
        </div>
        <button
          onClick={() => setInviting((v) => !v)}
          className="flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-medium text-white hover:bg-brand-600"
        >
          <Icon name="person_add" size={15} /> {inviting ? "Cancel" : "Invite user"}
        </button>
      </div>

      {inviting && (
        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="name@company.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Full name</label>
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Optional"
            />
          </div>
          <button
            type="submit"
            disabled={inviteBusy}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {inviteBusy ? "Sending..." : "Send invite"}
          </button>
          {inviteError && <p className="w-full text-sm text-rose-600">{inviteError}</p>}
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Name / email</th>
              <th className="px-4 py-2">Admin/User role</th>
              <th className="px-4 py-2">Custom role</th>
              <th className="px-4 py-2">Joined</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <p className="flex items-center font-medium text-slate-900">
                    {p.full_name || "—"}
                    {p.id === currentUserId && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                    <StatusBadge profile={p} />
                  </p>
                  <p className="text-xs text-slate-400">{p.email || "no email on file"}</p>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={p.role}
                    onChange={(e) => {
                      const role = e.target.value as "admin" | "sales";
                      if (p.id === currentUserId && role !== "admin" && !confirm("This will remove your own admin access. Continue?")) return;
                      updateField(p.id, { role });
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="sales">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={p.role_id ?? ""}
                    onChange={(e) => updateField(p.id, { role_id: e.target.value || null })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">No custom role</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(p.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    {p.status === "invited" && !p.disabled && (
                      <button
                        onClick={() => handleResendInvite(p)}
                        disabled={resendId === p.id}
                        className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                      >
                        <Icon name="forward_to_inbox" size={13} />
                        {resendSentId === p.id ? "Invite resent" : resendId === p.id ? "Sending..." : "Resend invite"}
                      </button>
                    )}
                    <button
                      onClick={() => handleResetPassword(p)}
                      disabled={busyId === p.id}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                    >
                      <Icon name="mail" size={13} />
                      {resetSentId === p.id ? "Reset link sent" : busyId === p.id ? "Sending..." : "Reset password"}
                    </button>
                    <button
                      onClick={() => handleToggleDisabled(p)}
                      disabled={statusBusyId === p.id || p.id === currentUserId}
                      title={p.id === currentUserId ? "You can't disable your own account" : undefined}
                      className={`flex items-center gap-1 text-xs font-medium hover:underline disabled:opacity-50 disabled:no-underline ${
                        p.disabled ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      <Icon name={p.disabled ? "lock_open" : "block"} size={13} />
                      {statusBusyId === p.id ? "Updating..." : p.disabled ? "Enable" : "Disable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dirty && (
        <div className="flex items-center justify-end gap-2 rounded-md bg-amber-50 px-3 py-2">
          <span className="mr-auto text-xs text-amber-700">Unsaved role changes</span>
          <button
            onClick={cancelChanges}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={saveChanges}
            disabled={saving}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}
