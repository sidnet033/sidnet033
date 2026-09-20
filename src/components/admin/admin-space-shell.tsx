"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { ToastProvider } from "@/components/admin/toast";
import { UsersTab } from "@/components/admin/users-tab";
import { RolesTab } from "@/components/admin/roles-tab";
import type { Profile, Role, RolePermission } from "@/types/database";

export function AdminSpaceShell({
  initialProfiles,
  initialRoles,
  initialPermissions,
  currentUserId,
}: {
  initialProfiles: Profile[];
  initialRoles: Role[];
  initialPermissions: RolePermission[];
  currentUserId: string;
}) {
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [profiles, setProfiles] = useState(initialProfiles);
  const [roles, setRoles] = useState(initialRoles);
  const [permsByRole, setPermsByRole] = useState<Record<string, RolePermission[]>>(() => {
    const grouped: Record<string, RolePermission[]> = {};
    for (const p of initialPermissions) (grouped[p.role_id] ??= []).push(p);
    return grouped;
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="flex w-full flex-col">
        {/* Hero header */}
        <div className="relative w-full overflow-hidden bg-surface-container-lowest px-margin-lg py-space-xl shadow-sm">
          <div className="pointer-events-none absolute -top-24 -right-16 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-tertiary/5 blur-2xl" />
          <div className="relative flex flex-col gap-space-lg lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl space-y-space-xs">
              <h1 className="font-display text-display tracking-tight text-on-surface">
                Admin Zone – {tab === "users" ? "Users" : "Roles"}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm self-start lg:self-center">
              <Link
                href="/admin/import-log"
                className="flex h-9 items-center gap-space-xs rounded bg-surface-container-low px-space-md font-label-md text-label-md text-on-surface shadow-sm transition-colors hover:bg-surface-container"
              >
                <Icon name="history_toggle_off" size={16} className="text-primary" />
                Audit Logs
              </Link>
              <button
                onClick={() => setCreateRoleOpen(true)}
                className="flex h-9 items-center gap-space-xs rounded bg-surface-container px-space-md font-label-md text-label-md text-on-surface shadow-sm transition-colors hover:bg-surface-variant"
              >
                <Icon name="shield_lock" size={16} className="text-tertiary" />+ Create New Role
              </button>
              <button
                onClick={() => setInviteOpen(true)}
                className="flex h-9 items-center gap-space-xs rounded bg-primary px-space-lg font-label-md text-label-md text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary-container"
              >
                <Icon name="person_add" size={18} />+ Invite / Add User
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-space-xl p-margin-lg">
          <div className="flex flex-col gap-space-lg">
            <div className="flex items-center justify-between overflow-x-auto rounded-xl bg-surface-container-lowest px-space-md shadow-sm">
              <div className="flex items-center gap-space-xs">
                <button
                  onClick={() => setTab("users")}
                  className={`flex items-center gap-space-xs py-space-md px-space-lg font-headline-sm text-headline-sm transition-all ${
                    tab === "users" ? "border-b-2 border-primary text-primary" : "text-secondary hover:text-on-surface"
                  }`}
                >
                  <Icon name="badge" size={18} />
                  Users Directory
                  <span
                    className={`ml-1 rounded-full px-space-xs py-0.5 text-[11px] font-bold ${
                      tab === "users" ? "bg-primary/10 text-primary" : "bg-surface-container-high text-secondary"
                    }`}
                  >
                    {profiles.length}
                  </span>
                </button>
                <button
                  onClick={() => setTab("roles")}
                  className={`flex items-center gap-space-xs py-space-md px-space-lg font-headline-sm text-headline-sm transition-all ${
                    tab === "roles" ? "border-b-2 border-primary text-primary" : "text-secondary hover:text-on-surface"
                  }`}
                >
                  <Icon name="security" size={18} />
                  Roles &amp; Permissions
                  <span
                    className={`ml-1 rounded-full px-space-xs py-0.5 text-[11px] font-bold ${
                      tab === "roles" ? "bg-primary/10 text-primary" : "bg-surface-container-high text-secondary"
                    }`}
                  >
                    {roles.length}
                  </span>
                </button>
              </div>
            </div>

            {tab === "users" ? (
              <UsersTab
                profiles={profiles}
                setProfiles={setProfiles}
                roles={roles}
                currentUserId={currentUserId}
                inviteOpen={inviteOpen}
                closeInvite={() => setInviteOpen(false)}
              />
            ) : (
              <RolesTab
                roles={roles}
                setRoles={setRoles}
                permsByRole={permsByRole}
                setPermsByRole={setPermsByRole}
                profiles={profiles}
                currentUserId={currentUserId}
                createOpen={createRoleOpen}
                closeCreate={() => setCreateRoleOpen(false)}
              />
            )}
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
