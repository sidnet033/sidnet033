"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { Modal } from "@/components/admin/modal";
import { useToast } from "@/components/admin/toast";
import type { Profile, Role } from "@/types/database";

type PendingChange = { role?: "admin" | "sales"; role_id?: string | null };

const PAGE_SIZE = 8;

const AVATAR_COLORS = [
  "bg-primary text-on-primary",
  "bg-secondary-container text-on-secondary-container",
  "bg-primary-fixed text-on-primary-fixed",
  "bg-tertiary-container text-on-tertiary-container",
  "bg-surface-container-highest text-secondary",
];

function initials(name: string | null, email: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function StatusBadge({ profile }: { profile: Profile }) {
  if (profile.disabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-error-container px-space-sm py-space-2xs text-xs font-semibold text-on-error-container">
        <span className="h-1.5 w-1.5 rounded-full bg-error" />
        Disabled
      </span>
    );
  }
  if (profile.status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-container/15 px-space-sm py-space-2xs text-xs font-semibold text-tertiary">
        <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-space-sm py-space-2xs text-xs font-semibold text-on-secondary-container">
      <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
      Invite Pending
    </span>
  );
}

export function UsersTab({
  profiles,
  setProfiles,
  roles,
  currentUserId,
  inviteOpen,
  closeInvite,
}: {
  profiles: Profile[];
  setProfiles: (updater: (prev: Profile[]) => Profile[]) => void;
  roles: Role[];
  currentUserId: string;
  inviteOpen: boolean;
  closeInvite: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const showToast = useToast();

  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "admin" | "sales">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "active" | "invited" | "disabled">("ALL");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const dirty = Object.keys(pending).length > 0;

  const adminCount = profiles.filter((p) => p.role === "admin").length;
  const userCount = profiles.filter((p) => p.role === "sales").length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (roleFilter !== "ALL" && p.role !== roleFilter) return false;
      if (statusFilter === "disabled" && !p.disabled) return false;
      if (statusFilter === "active" && (p.status !== "active" || p.disabled)) return false;
      if (statusFilter === "invited" && (p.status !== "invited" || p.disabled)) return false;
      if (!q) return true;
      return (p.full_name || "").toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q);
    });
  }, [profiles, search, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function resetFilters() {
    setSearch("");
    setRoleFilter("ALL");
    setStatusFilter("ALL");
    setPage(1);
  }

  // pending role/role_id edits are kept as a local overlay rather than
  // written into the shared `profiles` state directly -- that way
  // Discard is just "drop the overlay", no revert-copy bookkeeping needed
  function effective(p: Profile): Profile {
    const patch = pending[p.id];
    return patch ? { ...p, ...patch } : p;
  }

  function updateField(id: string, patch: PendingChange) {
    setPending((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function cancelChanges() {
    setPending({});
  }

  async function refreshProfiles() {
    const { data: fresh } = await supabase.from("profiles").select("*").order("created_at");
    if (fresh) setProfiles(() => fresh as Profile[]);
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
    setProfiles((prev) => prev.map((p) => (pending[p.id] ? { ...p, ...pending[p.id] } : p)));
    setSaving(false);
    setPending({});
    showToast("Changes Saved", "Role assignments updated successfully.");
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
    closeInvite();
    showToast("Invitation Dispatched", "Activation link sent to the new user.");
  }

  async function handleResendInvite(profile: Profile) {
    if (!profile.email) {
      alert("This user has no email on file.");
      return;
    }
    setBusyId(profile.id);
    const res = await fetch("/api/admin/invite-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: profile.email, fullName: profile.full_name || undefined }),
    });
    const body = await res.json();
    setBusyId(null);
    if (!res.ok) {
      alert(body.error || "Could not resend the invite.");
      return;
    }
    showToast("Invitation Resent", `A fresh activation link was sent to ${profile.email}.`);
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
    showToast("Reset Link Sent", `Password reset email sent to ${profile.email}.`);
  }

  async function setDisabled(ids: string[], disabled: boolean) {
    for (const id of ids) {
      if (id === currentUserId) continue;
      const res = await fetch("/api/admin/set-user-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, disabled }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || "Could not update account access.");
        return false;
      }
    }
    setProfiles((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, disabled } : p)));
    return true;
  }

  async function handleToggleDisabled(profile: Profile) {
    const disabled = !profile.disabled;
    if (disabled && !confirm(`Disable ${profile.full_name || profile.email}? They won't be able to sign in until you re-enable them.`)) return;
    setBusyId(profile.id);
    const ok = await setDisabled([profile.id], disabled);
    setBusyId(null);
    if (ok) showToast(disabled ? "User Disabled" : "User Enabled", `${profile.full_name || profile.email} ${disabled ? "can no longer sign in." : "can sign in again."}`);
  }

  async function handleBulkDisable() {
    const ids = [...selected].filter((id) => id !== currentUserId);
    if (ids.length === 0) return;
    if (!confirm(`Disable ${ids.length} selected user(s)? They won't be able to sign in until re-enabled.`)) return;
    setBulkBusy(true);
    const ok = await setDisabled(ids, true);
    setBulkBusy(false);
    if (ok) {
      showToast("Users Disabled", `${ids.length} account(s) can no longer sign in.`);
      setSelected(new Set());
    }
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(checked ? new Set(pageRows.map((p) => p.id)) : new Set());
  }

  function toggleSelectOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="w-full space-y-space-md">
      <SavingOverlay show={saving} />
      <Modal
        open={inviteOpen}
        onClose={closeInvite}
        icon="person_add"
        title="Invite / Add User"
        description="Send an activation link so they can sign in and set their own password."
      >
        <form onSubmit={handleInvite} className="space-y-space-md">
          <div className="space-y-1">
            <label className="block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Full name</label>
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="h-9 w-full rounded bg-surface-container-low px-space-sm text-body-sm text-on-surface outline-none focus:bg-white focus:ring-2 focus:ring-primary/20"
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <label className="block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Corporate email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="h-9 w-full rounded bg-surface-container-low px-space-sm text-body-sm text-on-surface outline-none focus:bg-white focus:ring-2 focus:ring-primary/20"
              placeholder="name@company.com"
            />
          </div>
          {inviteError && <p className="text-sm text-error">{inviteError}</p>}
          <div className="flex items-center justify-end gap-space-sm pt-space-sm">
            <button
              type="button"
              onClick={closeInvite}
              className="rounded bg-surface-container px-space-md py-space-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-variant"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviteBusy}
              className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:opacity-50"
            >
              <Icon name="send" size={16} />
              {inviteBusy ? "Sending..." : "Send Activation Invitation"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Filter & Search console */}
      <div className="space-y-space-md rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
        <div className="flex flex-col items-stretch justify-between gap-space-md lg:flex-row lg:items-center">
          <div className="relative min-w-[260px] flex-1">
            <Icon name="search" size={18} className="absolute left-space-md top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name or email..."
              className="h-9 w-full rounded bg-surface-container-low pl-10 pr-space-md font-body-md text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-wrap items-center gap-space-xs">
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as typeof roleFilter);
                setPage(1);
              }}
              className="h-9 cursor-pointer rounded bg-surface-container-low px-space-md font-body-sm text-body-sm text-on-surface outline-none"
            >
              <option value="ALL">All Roles (2)</option>
              <option value="admin">Admin ({adminCount})</option>
              <option value="sales">User ({userCount})</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as typeof statusFilter);
                setPage(1);
              }}
              className="h-9 cursor-pointer rounded bg-surface-container-low px-space-md font-body-sm text-body-sm text-on-surface outline-none"
            >
              <option value="ALL">Status: Any</option>
              <option value="active">Active</option>
              <option value="invited">Invite Pending</option>
              <option value="disabled">Disabled</option>
            </select>
            <button
              onClick={resetFilters}
              title="Reset Filters"
              className="flex h-9 items-center justify-center rounded bg-surface-container-low px-space-sm text-secondary hover:bg-surface-container-high"
            >
              <Icon name="filter_alt_off" size={18} />
            </button>
          </div>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center justify-between gap-space-sm rounded-lg bg-surface-container-high px-space-md py-space-xs font-body-sm text-body-sm text-on-surface">
            <div className="flex items-center gap-space-xs">
              <input
                type="checkbox"
                checked={pageRows.length > 0 && pageRows.every((p) => selected.has(p.id))}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded text-primary"
              />
              <span className="font-medium">{selected.size} User{selected.size === 1 ? "" : "s"} Selected</span>
            </div>
            <button
              onClick={handleBulkDisable}
              disabled={bulkBusy}
              className="rounded bg-error-container px-space-sm py-1 font-label-md text-label-md text-on-error-container shadow-sm hover:bg-error/20 disabled:opacity-50"
            >
              {bulkBusy ? "Disabling..." : "Disable Selected"}
            </button>
          </div>
        )}
      </div>

      {/* Users table */}
      <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-container-low font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                <th className="w-10 px-space-md py-space-sm text-center">
                  <input
                    type="checkbox"
                    checked={pageRows.length > 0 && pageRows.every((p) => selected.has(p.id))}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded text-primary"
                  />
                </th>
                <th className="px-space-md py-space-sm">User &amp; Contact</th>
                <th className="px-space-md py-space-sm">Admin/User Role</th>
                <th className="px-space-md py-space-sm">Custom Role</th>
                <th className="px-space-md py-space-sm">Status</th>
                <th className="px-space-md py-space-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container font-body-sm text-body-sm">
              {pageRows.map((p, i) => {
                const row = effective(p);
                return (
                <tr key={p.id} className="transition-colors hover:bg-surface-container-low">
                  <td className="px-space-md py-space-md text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={(e) => toggleSelectOne(p.id, e.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded text-primary"
                    />
                  </td>
                  <td className="px-space-md py-space-md">
                    <div className="flex items-center gap-space-sm">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full font-headline-sm text-headline-sm font-bold shadow-sm ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                      >
                        {initials(p.full_name, p.email)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-headline-sm text-headline-sm font-semibold text-on-surface">
                          {p.full_name || "—"}
                          {p.id === currentUserId && (
                            <span className="rounded bg-tertiary-fixed px-1 text-[10px] font-bold uppercase text-on-tertiary-fixed">You</span>
                          )}
                        </div>
                        <div className="truncate font-label-md text-label-md text-secondary">{p.email || "no email on file"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-space-md py-space-md">
                    <select
                      value={row.role}
                      onChange={(e) => {
                        const role = e.target.value as "admin" | "sales";
                        if (p.id === currentUserId && role !== "admin" && !confirm("This will remove your own admin access. Continue?")) return;
                        updateField(p.id, { role });
                      }}
                      className="h-8 cursor-pointer rounded border border-surface-container-high bg-surface-container-low px-2 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="sales">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-space-md py-space-md">
                    <select
                      value={row.role_id ?? ""}
                      onChange={(e) => updateField(p.id, { role_id: e.target.value || null })}
                      className="h-8 cursor-pointer rounded border border-surface-container-high bg-surface-container-low px-2 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">No custom role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-space-md py-space-md">
                    <StatusBadge profile={p} />
                  </td>
                  <td className="px-space-md py-space-md text-right">
                    <div className="flex items-center justify-end gap-1">
                      {p.status === "invited" && !p.disabled && (
                        <button
                          onClick={() => handleResendInvite(p)}
                          disabled={busyId === p.id}
                          title="Resend Invite"
                          className="rounded bg-surface-container px-space-xs py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-on-primary disabled:opacity-50"
                        >
                          Resend
                        </button>
                      )}
                      <button
                        onClick={() => handleResetPassword(p)}
                        disabled={busyId === p.id}
                        title="Reset Password"
                        className="rounded p-1 text-secondary transition-colors hover:bg-surface-container-high hover:text-primary disabled:opacity-50"
                      >
                        <Icon name="mail" size={18} />
                      </button>
                      <button
                        onClick={() => handleToggleDisabled(p)}
                        disabled={busyId === p.id || p.id === currentUserId}
                        title={p.id === currentUserId ? "You can't disable your own account" : p.disabled ? "Enable" : "Disable"}
                        className="rounded p-1 text-secondary transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
                      >
                        <Icon name={p.disabled ? "lock_open" : "block"} size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-space-md py-space-xl text-center text-secondary">
                    No users match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between bg-surface-container-low p-space-md font-body-sm text-body-sm text-secondary">
          <div>
            Showing <span className="font-semibold text-on-surface">{filtered.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)}</span> of{" "}
            <span className="font-semibold text-on-surface">{filtered.length}</span> users
          </div>
          <div className="flex items-center gap-space-xs">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex h-8 w-8 items-center justify-center rounded bg-surface-container text-on-surface hover:bg-surface-variant disabled:opacity-40"
            >
              <Icon name="chevron_left" size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`flex h-8 w-8 items-center justify-center rounded text-xs font-medium ${
                  n === page ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex h-8 w-8 items-center justify-center rounded bg-surface-container text-on-surface hover:bg-surface-variant disabled:opacity-40"
            >
              <Icon name="chevron_right" size={16} />
            </button>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="flex items-center justify-end gap-space-sm rounded-lg bg-surface-container-high px-space-md py-space-sm">
          <span className="mr-auto font-body-sm text-body-sm text-on-surface">Unsaved role changes</span>
          <button
            onClick={cancelChanges}
            disabled={saving}
            className="rounded bg-surface-container-lowest px-space-md py-space-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={saveChanges}
            disabled={saving}
            className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:opacity-50"
          >
            <Icon name="save" size={16} />
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}
    </div>
  );
}
