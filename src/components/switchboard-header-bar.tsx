"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { RevisionLockControls, type LockState } from "@/components/revision-lock-controls";
import { Icon } from "@/components/icon";
import type { SwitchboardContext } from "@/lib/switchboard-context";

const TABS = [
  { slug: "summary", label: "Summary" },
  { slug: "bom", label: "BOM Builder" },
  { slug: "ga", label: "GA Builder" },
];

export function SwitchboardHeaderBar({
  ctx,
  currentUserId,
  currentUserName,
  isAdmin,
  lockState,
  onStateChange,
}: {
  ctx: SwitchboardContext;
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  lockState: LockState;
  onStateChange: (state: LockState) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { switchboard, revision, project, customer } = ctx;
  const readOnly = lockState.archived || (lockState.locked_by !== null && lockState.locked_by !== currentUserId);

  return (
    <div className="space-y-3 border-b border-slate-200/90 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <Link href="/" className="hover:underline">
            Projects
          </Link>
          <span>/</span>
          <span className="text-slate-700">
            {project.code}
            {customer ? ` · ${customer.name}` : ""}
          </span>
          <span>/</span>
          <Link href={`/revisions/${revision.id}/costing`} className="hover:underline">
            Rev {revision.revision_number}
          </Link>
          <span>/</span>
          {ctx.siblingSwitchboards.length > 1 ? (
            <select
              value={switchboard.id}
              onChange={(e) => {
                const tab = pathname.split("/").pop();
                router.push(`/switchboards/${e.target.value}/${tab}`);
              }}
              className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs font-medium text-slate-900"
            >
              {ctx.siblingSwitchboards.map((sb) => (
                <option key={sb.id} value={sb.id}>
                  {sb.tag}
                  {sb.title ? `: ${sb.title}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-medium text-slate-900">
              {switchboard.tag}
              {switchboard.title ? `: ${switchboard.title}` : ""}
            </span>
          )}
        </div>
        <RevisionLockControls
          revisionId={revision.id}
          initialLockedBy={revision.locked_by}
          initialLockedByName={ctx.lockedByName}
          initialArchived={revision.archived}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          isAdmin={isAdmin}
          createdBy={revision.created_by}
          revisionNumber={revision.revision_number}
          siblingRevisions={ctx.siblingRevisions}
          onStateChange={onStateChange}
        />
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <Icon name="visibility" size={15} />
          {lockState.archived
            ? "This revision is archived — read only."
            : "Locked by another user — you can look around, but editing is off until it's released."}
        </div>
      )}

      <nav className="flex gap-1">
        {TABS.map((t) => {
          const href = `/switchboards/${switchboard.id}/${t.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={t.slug}
              href={href}
              className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${
                active ? "border-b-2 border-brand-500 text-brand-600" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
