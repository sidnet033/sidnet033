"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import type { SiblingRevision } from "@/lib/switchboard-context";

export type LockState = { locked_by: string | null; archived: boolean };

export function RevisionLockControls({
  revisionId,
  initialLockedBy,
  initialLockedByName,
  initialArchived,
  currentUserId,
  currentUserName,
  isAdmin,
  createdBy,
  revisionNumber,
  siblingRevisions,
  onStateChange,
}: {
  revisionId: string;
  initialLockedBy: string | null;
  initialLockedByName: string | null;
  initialArchived: boolean;
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  createdBy: string | null;
  revisionNumber: number;
  siblingRevisions: SiblingRevision[];
  onStateChange?: (state: LockState) => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [lockedBy, setLockedBy] = useState(initialLockedBy);
  const [lockedByName, setLockedByName] = useState(initialLockedByName);
  const [archived, setArchived] = useState(initialArchived);
  const [busy, setBusy] = useState(false);

  const isLockedByMe = lockedBy !== null && lockedBy === currentUserId;
  const isLockedByOther = lockedBy !== null && !isLockedByMe;
  const canUnarchive = archived && (createdBy === currentUserId || isAdmin);

  async function run(
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    onSuccess: () => void
  ) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    onSuccess();
  }

  function handleLock() {
    run(
      () => supabase.rpc("lock_revision", { p_revision_id: revisionId }),
      () => {
        setLockedBy(currentUserId);
        setLockedByName(currentUserName);
        onStateChange?.({ locked_by: currentUserId, archived });
      }
    );
  }

  function handleUnlock() {
    run(
      () => supabase.rpc("unlock_revision", { p_revision_id: revisionId }),
      () => {
        setLockedBy(null);
        setLockedByName(null);
        onStateChange?.({ locked_by: null, archived });
      }
    );
  }

  function handleArchive() {
    if (!confirm("Archive this revision? It becomes read-only for everyone until un-archived.")) return;
    run(
      () => supabase.rpc("archive_revision", { p_revision_id: revisionId }),
      () => {
        setArchived(true);
        setLockedBy(null);
        setLockedByName(null);
        onStateChange?.({ locked_by: null, archived: true });
      }
    );
  }

  function handleUnarchive() {
    run(
      () => supabase.rpc("unarchive_revision", { p_revision_id: revisionId }),
      () => {
        setArchived(false);
        onStateChange?.({ locked_by: null, archived: false });
      }
    );
  }

  async function handleCreateRevision() {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_revision", { p_revision_id: revisionId });
    if (error) {
      setBusy(false);
      alert(error.message);
      return;
    }
    const { data: firstSwitchboard } = await supabase
      .from("switchboards")
      .select("id")
      .eq("revision_id", data)
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    setBusy(false);
    router.push(firstSwitchboard ? `/switchboards/${firstSwitchboard.id}/summary` : `/revisions/${data}/costing`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">
        Rev {revisionNumber}
      </span>

      {siblingRevisions.length > 1 && (
        <select
          value={revisionId}
          onChange={(e) => router.push(`/revisions/${e.target.value}/costing`)}
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
      ) : lockedBy === null ? (
        <button
          onClick={handleLock}
          disabled={busy}
          className="flex items-center gap-1 rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          <Icon name="lock" size={13} /> Lock to edit
        </button>
      ) : isLockedByMe ? (
        <>
          <span className="flex items-center gap-1 rounded border border-emerald-200/60 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600">
            <Icon name="lock_open" size={13} /> Locked by you
          </span>
          <button
            onClick={handleUnlock}
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Release lock
          </button>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1 rounded border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
            <Icon name="lock" size={13} /> Locked by {lockedByName || "another user"}
          </span>
          {isAdmin && (
            <button
              onClick={handleUnlock}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Force unlock
            </button>
          )}
        </>
      )}

      {!archived && !isLockedByOther && (
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
