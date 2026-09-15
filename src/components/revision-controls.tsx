"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import type { SiblingRevision } from "@/lib/revision-context";

export function RevisionControls({
  revisionId,
  initialArchived,
  currentUserId,
  isAdmin,
  createdBy,
  revisionNumber,
  siblingRevisions,
  onStateChange,
}: {
  revisionId: string;
  initialArchived: boolean;
  currentUserId: string;
  isAdmin: boolean;
  createdBy: string | null;
  revisionNumber: number;
  siblingRevisions: SiblingRevision[];
  onStateChange?: (archived: boolean) => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [archived, setArchived] = useState(initialArchived);
  const [busy, setBusy] = useState(false);

  const canUnarchive = archived && (createdBy === currentUserId || isAdmin);

  async function handleArchive() {
    if (!confirm("Archive this revision? It becomes read-only for everyone until un-archived.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("archive_revision", { p_revision_id: revisionId });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setArchived(true);
    onStateChange?.(true);
    router.refresh();
  }

  async function handleUnarchive() {
    setBusy(true);
    const { error } = await supabase.rpc("unarchive_revision", { p_revision_id: revisionId });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setArchived(false);
    onStateChange?.(false);
    router.refresh();
  }

  async function handleCreateRevision() {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_revision", { p_revision_id: revisionId });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.push(`/revisions/${data}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">
        Rev {revisionNumber}
      </span>

      {siblingRevisions.length > 1 && (
        <select
          value={revisionId}
          onChange={(e) => router.push(`/revisions/${e.target.value}`)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        >
          {siblingRevisions.map((s) => (
            <option key={s.id} value={s.id}>
              Rev {s.revision_number} · {s.status}
            </option>
          ))}
        </select>
      )}

      <button
        onClick={handleCreateRevision}
        disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        + New revision
      </button>

      {archived ? (
        <>
          <span className="flex items-center gap-1 rounded border border-rose-200/60 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
            <Icon name="archive" size={13} /> Archived — read only
          </span>
          {canUnarchive && (
            <button
              onClick={handleUnarchive}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Un-archive
            </button>
          )}
        </>
      ) : (
        <button
          onClick={handleArchive}
          disabled={busy}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Archive
        </button>
      )}
    </div>
  );
}
