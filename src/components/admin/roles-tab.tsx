"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { Modal } from "@/components/admin/modal";
import { useToast } from "@/components/admin/toast";
import type { Profile, Role, RolePermission } from "@/types/database";

const RESOURCES: { id: string; label: string; icon: string }[] = [
  { id: "item_master", label: "Item Master", icon: "category" },
  { id: "feeder_master", label: "Feeder Master", icon: "cable" },
  { id: "projects", label: "Projects & Quotes", icon: "engineering" },
  { id: "customers", label: "Customers", icon: "groups" },
  { id: "user_management", label: "User & Role Management", icon: "security" },
  { id: "import_log", label: "Import Audit Log", icon: "history_toggle_off" },
];

type MatrixCell = { can_view: boolean; can_create: boolean; can_edit: boolean; can_archive: boolean };
type Matrix = Record<string, MatrixCell>;

const PERMISSION_COLUMNS: { key: keyof MatrixCell; label: string }[] = [
  { key: "can_view", label: "View" },
  { key: "can_create", label: "Create" },
  { key: "can_edit", label: "Edit" },
  { key: "can_archive", label: "Archive" },
];

const CARD_ICONS = ["shield_person", "engineering", "price_check", "build", "verified_user"];

function emptyMatrix(): Matrix {
  const m: Matrix = {};
  for (const r of RESOURCES) m[r.id] = { can_view: false, can_create: false, can_edit: false, can_archive: false };
  return m;
}

function matrixFromPermissions(perms: RolePermission[]): Matrix {
  const m = emptyMatrix();
  for (const p of perms) {
    if (m[p.resource]) {
      m[p.resource] = { can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_archive: p.can_archive };
    }
  }
  return m;
}

export function RolesTab({
  roles,
  setRoles,
  permsByRole,
  setPermsByRole,
  profiles,
  currentUserId,
  createOpen,
  closeCreate,
}: {
  roles: Role[];
  setRoles: (updater: (prev: Role[]) => Role[]) => void;
  permsByRole: Record<string, RolePermission[]>;
  setPermsByRole: (updater: (prev: Record<string, RolePermission[]>) => Record<string, RolePermission[]>) => void;
  profiles: Profile[];
  currentUserId: string;
  createOpen: boolean;
  closeCreate: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const showToast = useToast();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(roles[0]?.id ?? null);
  const [matrix, setMatrix] = useState<Matrix>(() => matrixFromPermissions(permsByRole[roles[0]?.id ?? ""] ?? []));
  const [savedMatrix, setSavedMatrix] = useState<Matrix>(matrix);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;
  const dirty = JSON.stringify(matrix) !== JSON.stringify(savedMatrix);

  function selectRole(id: string) {
    setSelectedRoleId(id);
    const m = matrixFromPermissions(permsByRole[id] ?? []);
    setMatrix(m);
    setSavedMatrix(m);
  }

  function toggleCell(resource: string, key: keyof MatrixCell) {
    setMatrix((prev) => ({ ...prev, [resource]: { ...prev[resource], [key]: !prev[resource][key] } }));
  }

  function toggleColumn(key: keyof MatrixCell) {
    setMatrix((prev) => {
      const allChecked = RESOURCES.every((r) => prev[r.id][key]);
      const next: Matrix = { ...prev };
      for (const r of RESOURCES) next[r.id] = { ...next[r.id], [key]: !allChecked };
      return next;
    });
  }

  function cancelMatrix() {
    setMatrix(savedMatrix);
    showToast("Changes Discarded", "Reverted permission adjustments.");
  }

  async function saveMatrix() {
    if (!selectedRoleId) return;
    setSaving(true);
    const rows = RESOURCES.map((r) => ({
      role_id: selectedRoleId,
      resource: r.id,
      can_view: matrix[r.id].can_view,
      can_create: matrix[r.id].can_create,
      can_edit: matrix[r.id].can_edit,
      can_archive: matrix[r.id].can_archive,
    }));
    const { data, error } = await supabase
      .from("role_permissions")
      .upsert(rows, { onConflict: "role_id,resource" })
      .select("*");
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setPermsByRole((prev) => ({ ...prev, [selectedRoleId]: (data ?? []) as RolePermission[] }));
    setSavedMatrix(matrix);
    showToast("Matrix Committed", "Permission scopes saved for this role.");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!newName.trim()) return;
    setCreateBusy(true);
    const { data, error } = await supabase
      .from("roles")
      .insert({ name: newName.trim(), description: newDescription.trim() || null, created_by: currentUserId })
      .select("*")
      .single();
    setCreateBusy(false);
    if (error) {
      setCreateError(error.message);
      return;
    }
    const role = data as Role;
    setRoles((prev) => [...prev, role]);
    setNewName("");
    setNewDescription("");
    closeCreate();
    selectRole(role.id);
    showToast("New Custom Role", `"${role.name}" is ready to configure.`);
  }

  async function handleDelete(role: Role) {
    if (!confirm(`Delete the role "${role.name}"? Users assigned to it will keep their Admin/User access but lose this custom role.`)) return;
    setDeletingId(role.id);
    const { error } = await supabase.from("roles").delete().eq("id", role.id);
    setDeletingId(null);
    if (error) {
      alert(error.message);
      return;
    }
    setRoles((prev) => prev.filter((r) => r.id !== role.id));
    setPermsByRole((prev) => {
      const next = { ...prev };
      delete next[role.id];
      return next;
    });
    if (selectedRoleId === role.id) {
      const remaining = roles.filter((r) => r.id !== role.id);
      if (remaining.length > 0) selectRole(remaining[0].id);
      else {
        setSelectedRoleId(null);
        setMatrix(emptyMatrix());
        setSavedMatrix(emptyMatrix());
      }
    }
    showToast("Role Deleted", `"${role.name}" has been removed.`);
  }

  return (
    <div className="w-full space-y-space-xl">
      <Modal
        open={createOpen}
        onClose={closeCreate}
        icon="shield_lock"
        title="Create New Role"
        description="Define a custom role and its access matrix."
      >
        <form onSubmit={handleCreate} className="space-y-space-md">
          <div className="space-y-1">
            <label className="block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Role name</label>
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-9 w-full rounded bg-surface-container-low px-space-sm text-body-sm text-on-surface outline-none focus:bg-white focus:ring-2 focus:ring-primary/20"
              placeholder="e.g. Lead Estimator"
            />
          </div>
          <div className="space-y-1">
            <label className="block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Description</label>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="h-9 w-full rounded bg-surface-container-low px-space-sm text-body-sm text-on-surface outline-none focus:bg-white focus:ring-2 focus:ring-primary/20"
              placeholder="Optional"
            />
          </div>
          {createError && <p className="text-sm text-error">{createError}</p>}
          <div className="flex items-center justify-end gap-space-sm pt-space-sm">
            <button
              type="button"
              onClick={closeCreate}
              className="rounded bg-surface-container px-space-md py-space-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-variant"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createBusy}
              className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:opacity-50"
            >
              <Icon name="add" size={16} />
              {createBusy ? "Creating..." : "Create Role"}
            </button>
          </div>
        </form>
      </Modal>

      <p className="rounded-lg bg-surface-container-low px-space-md py-space-sm font-body-sm text-body-sm text-secondary">
        These roles and permissions are a management layer only — they aren&apos;t enforced anywhere in the app yet.
        Actual access still runs on the Admin/User role in the Users tab.
      </p>

      {/* Role Configurator Card */}
      <div className="flex flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="space-y-space-xs border-b border-surface-container-high bg-surface-container-low/50 p-space-md">
          <div className="flex flex-col justify-between gap-space-xs sm:flex-row sm:items-center">
            <label className="block font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
              Select Role to Configure
            </label>
            {selectedRole && (
              <button
                onClick={() => handleDelete(selectedRole)}
                disabled={deletingId === selectedRole.id}
                className="flex items-center gap-1 self-start text-xs font-semibold text-error hover:underline disabled:opacity-50 sm:self-auto"
              >
                <Icon name="delete" size={13} />
                {deletingId === selectedRole.id ? "Deleting..." : "Delete this role"}
              </button>
            )}
          </div>
          {roles.length > 0 ? (
            <>
              <div className="relative mt-1 max-w-xl">
                <select
                  value={selectedRoleId ?? ""}
                  onChange={(e) => selectRole(e.target.value)}
                  className="h-10 w-full cursor-pointer appearance-none rounded border border-surface-container-high bg-surface-container-lowest px-space-md font-headline-sm text-headline-sm text-on-surface shadow-sm outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <Icon name="unfold_more" size={18} className="pointer-events-none absolute right-space-md top-1/2 -translate-y-1/2 text-secondary" />
              </div>
              <p className="pt-1 font-body-sm text-body-sm text-secondary">
                Configuring access rights and granular privileges for the selected role.
              </p>
            </>
          ) : (
            <p className="pt-1 font-body-sm text-body-sm text-secondary">
              No custom roles yet. Use &quot;+ New Custom Role&quot; below to create one.
            </p>
          )}
        </div>

        {roles.length > 0 && (
          <>
            <div className="space-y-space-lg overflow-x-auto p-space-md">
              <div className="overflow-hidden rounded-lg border border-surface-container-high">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-surface-container-low font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="w-56 px-space-md py-space-sm font-semibold">Module / Category</th>
                      {PERMISSION_COLUMNS.map((col) => (
                        <th key={col.key} className="w-20 px-space-md py-space-sm text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span>{col.label}</span>
                            <input
                              type="checkbox"
                              title={`Toggle ${col.label} for every row`}
                              checked={RESOURCES.every((r) => matrix[r.id][col.key])}
                              onChange={() => toggleColumn(col.key)}
                              className="h-3.5 w-3.5 cursor-pointer rounded text-primary"
                            />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container bg-surface-container-lowest font-body-sm text-body-sm">
                    {RESOURCES.map((r) => (
                      <tr key={r.id} className="transition-colors hover:bg-surface-container-low">
                        <td className="px-space-md py-space-sm text-xs font-medium text-primary">
                          <span className="flex items-center gap-1.5">
                            <Icon name={r.icon} size={16} />
                            {r.label}
                          </span>
                        </td>
                        {PERMISSION_COLUMNS.map((col) => (
                          <td key={col.key} className="px-space-md py-space-sm text-center">
                            <input
                              type="checkbox"
                              checked={matrix[r.id][col.key]}
                              onChange={() => toggleCell(r.id, col.key)}
                              className="h-4 w-4 cursor-pointer rounded text-primary"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex items-center justify-between gap-space-sm border-t border-surface-container-high/40 bg-surface-container-low p-space-md">
              <button
                onClick={cancelMatrix}
                disabled={saving || !dirty}
                className="rounded bg-surface-container-lowest px-space-md py-space-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={saveMatrix}
                disabled={saving || !dirty}
                className="flex items-center justify-center gap-1 rounded bg-primary px-space-xl py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:opacity-50"
              >
                <Icon name="save" size={16} />
                {saving ? "Saving..." : "Save Permissions Matrix"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Roles & Assigned Members */}
      <div className="space-y-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <div>
            <h2 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Roles &amp; Assigned Members</h2>
            <p className="font-body-sm text-body-sm text-secondary">
              {roles.length} custom role{roles.length === 1 ? "" : "s"} and every team member mapped to each one.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role, i) => {
            const members = profiles.filter((p) => p.role_id === role.id);
            const grantedResources = RESOURCES.filter((r) => {
              const cell = matrixFromPermissions(permsByRole[role.id] ?? [])[r.id];
              return cell.can_view || cell.can_create || cell.can_edit || cell.can_archive;
            });
            return (
              <div
                key={role.id}
                className="flex flex-col justify-between rounded-xl bg-surface-container-lowest p-space-lg shadow-sm transition-all hover:shadow-md"
              >
                <div className="space-y-space-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-fixed font-bold text-primary">
                      <Icon name={CARD_ICONS[i % CARD_ICONS.length]} size={20} />
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="rounded bg-primary/10 px-space-xs py-0.5 font-mono text-xs font-bold text-primary">
                        {members.length} Member{members.length === 1 ? "" : "s"}
                      </span>
                      <button
                        onClick={() => handleDelete(role)}
                        disabled={deletingId === role.id}
                        title="Delete role"
                        className="rounded p-1 text-secondary hover:bg-error-container hover:text-on-error-container disabled:opacity-50"
                      >
                        <Icon name="delete" size={14} />
                      </button>
                    </div>
                  </div>
                  <div>
                    <button onClick={() => selectRole(role.id)} className="font-headline-md text-headline-md text-on-surface hover:text-primary">
                      {role.name}
                    </button>
                    <p className="mt-1 font-body-sm text-body-sm text-secondary">{role.description || "No description yet."}</p>
                  </div>
                  {grantedResources.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {grantedResources.map((r) => (
                        <span key={r.id} className="rounded bg-surface-container px-2 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                          {r.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {members.length > 0 && (
                    <div className="space-y-space-xs border-t border-surface-container pt-space-xs">
                      <div className="py-1 font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                        Assigned Users
                      </div>
                      <div className="space-y-1.5">
                        {members.map((m) => (
                          <div key={m.id} className="flex items-center justify-between rounded-lg bg-surface-container-low p-2">
                            <div className="flex items-center gap-space-sm">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-container text-xs font-bold text-on-secondary-container">
                                {(m.full_name || m.email || "?").slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex items-center gap-1 font-headline-sm text-xs font-semibold text-on-surface">
                                  {m.full_name || m.email}
                                  {m.id === currentUserId && <span className="rounded bg-tertiary-fixed px-1 text-[9px] font-bold uppercase text-on-tertiary-fixed">You</span>}
                                </div>
                                <div className="text-[11px] text-secondary">{m.email}</div>
                              </div>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                m.disabled
                                  ? "bg-error-container text-on-error-container"
                                  : m.status === "active"
                                    ? "bg-tertiary-container/15 text-tertiary"
                                    : "bg-secondary-container text-on-secondary-container"
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${m.disabled ? "bg-error" : m.status === "active" ? "bg-tertiary" : "bg-secondary"}`} />
                              {m.disabled ? "Disabled" : m.status === "active" ? "Active" : "Invited"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {roles.length === 0 && (
            <div className="rounded-xl border border-dashed border-surface-container-high px-space-md py-space-xl text-center text-sm text-secondary md:col-span-2 xl:col-span-3">
              No custom roles yet. Create one to define an access matrix.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
