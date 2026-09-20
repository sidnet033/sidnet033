"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import type { Role, RolePermission } from "@/types/database";

const RESOURCES: { id: string; label: string }[] = [
  { id: "item_master", label: "Item Master" },
  { id: "feeder_master", label: "Feeder Master" },
  { id: "projects", label: "Projects & Quotes" },
  { id: "customers", label: "Customers" },
  { id: "user_management", label: "User & Role Management" },
  { id: "import_log", label: "Import Audit Log" },
];

type MatrixCell = { can_create: boolean; can_edit: boolean; can_delete: boolean };
type Matrix = Record<string, MatrixCell>;

function emptyMatrix(): Matrix {
  const m: Matrix = {};
  for (const r of RESOURCES) m[r.id] = { can_create: false, can_edit: false, can_delete: false };
  return m;
}

function matrixFromPermissions(perms: RolePermission[]): Matrix {
  const m = emptyMatrix();
  for (const p of perms) {
    if (m[p.resource]) {
      m[p.resource] = { can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete };
    }
  }
  return m;
}

export function RoleManagementSection({
  initialRoles,
  initialPermissions,
  currentUserId,
}: {
  initialRoles: Role[];
  initialPermissions: RolePermission[];
  currentUserId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [roles, setRoles] = useState(initialRoles);
  const [permsByRole, setPermsByRole] = useState<Record<string, RolePermission[]>>(() => {
    const grouped: Record<string, RolePermission[]> = {};
    for (const p of initialPermissions) {
      (grouped[p.role_id] ??= []).push(p);
    }
    return grouped;
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<Matrix>(emptyMatrix());
  const [savedMatrix, setSavedMatrix] = useState<Matrix>(emptyMatrix());
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(matrix) !== JSON.stringify(savedMatrix), [matrix, savedMatrix]);

  function openRole(role: Role) {
    if (expandedId === role.id) {
      setExpandedId(null);
      return;
    }
    const m = matrixFromPermissions(permsByRole[role.id] ?? []);
    setMatrix(m);
    setSavedMatrix(m);
    setExpandedId(role.id);
  }

  function toggleCell(resource: string, key: keyof MatrixCell) {
    setMatrix((prev) => ({
      ...prev,
      [resource]: { ...prev[resource], [key]: !prev[resource][key] },
    }));
  }

  function cancelMatrix() {
    setMatrix(savedMatrix);
  }

  async function saveMatrix(roleId: string) {
    setSaving(true);
    const rows = RESOURCES.map((r) => ({
      role_id: roleId,
      resource: r.id,
      can_create: matrix[r.id].can_create,
      can_edit: matrix[r.id].can_edit,
      can_delete: matrix[r.id].can_delete,
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
    setPermsByRole((prev) => ({ ...prev, [roleId]: (data ?? []) as RolePermission[] }));
    setSavedMatrix(matrix);
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
    setRoles((prev) => [...prev, data as Role]);
    setNewName("");
    setNewDescription("");
    setCreating(false);
  }

  async function handleDelete(role: Role) {
    if (!confirm(`Delete the role "${role.name}"? Users assigned to it will keep their Admin/Sales access but lose this custom role.`)) return;
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
    if (expandedId === role.id) setExpandedId(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-on-surface">Roles &amp; access matrix</h2>
          <p className="text-xs text-secondary">
            These roles and permissions are a management layer only — they aren&apos;t enforced anywhere in the app
            yet. Actual access still runs on the Admin/Sales role in the Users section above.
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-medium text-white hover:bg-brand-600"
        >
          <Icon name="add" size={15} /> {creating ? "Cancel" : "New role"}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Role name</label>
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="e.g. Estimator"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Optional"
            />
          </div>
          <button
            type="submit"
            disabled={createBusy}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {createBusy ? "Creating..." : "Create role"}
          </button>
          {createError && <p className="w-full text-sm text-rose-600">{createError}</p>}
        </form>
      )}

      <div className="space-y-2">
        {roles.map((role) => {
          const isOpen = expandedId === role.id;
          return (
            <div key={role.id} className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
              <div className="flex items-center justify-between px-4 py-3">
                <button onClick={() => openRole(role)} className="flex flex-1 items-center gap-2 text-left">
                  <Icon name={isOpen ? "expand_more" : "chevron_right"} size={18} className="text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{role.name}</p>
                    {role.description && <p className="text-xs text-slate-400">{role.description}</p>}
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(role)}
                  disabled={deletingId === role.id}
                  className="flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
                >
                  <Icon name="delete" size={13} />
                  {deletingId === role.id ? "Deleting..." : "Delete"}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2">Access</th>
                        <th className="w-20 py-2 text-center">Create</th>
                        <th className="w-20 py-2 text-center">Edit</th>
                        <th className="w-20 py-2 text-center">Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RESOURCES.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="py-2 text-slate-700">{r.label}</td>
                          {(["can_create", "can_edit", "can_delete"] as const).map((key) => (
                            <td key={key} className="py-2 text-center">
                              <input
                                type="checkbox"
                                checked={matrix[r.id][key]}
                                onChange={() => toggleCell(r.id, key)}
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {dirty && (
                    <div className="mt-3 flex items-center justify-end gap-2 rounded-md bg-amber-50 px-3 py-2">
                      <span className="mr-auto text-xs text-amber-700">Unsaved permission changes</span>
                      <button
                        onClick={cancelMatrix}
                        disabled={saving}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveMatrix(role.id)}
                        disabled={saving}
                        className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {roles.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            No custom roles yet. Create one to define an access matrix.
          </div>
        )}
      </div>
    </div>
  );
}
