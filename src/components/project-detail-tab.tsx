"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import type { SwitchboardListItem } from "@/lib/revision-context";
import type { Project } from "@/types/database";
import type { Tab } from "@/components/revision-workspace";

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function ProjectDetailTab({
  project,
  switchboards,
  currentUserId,
  isAdmin,
  revisionId,
  revisionArchived,
  onOpenSwitchboard,
  onSwitchboardDeleted,
}: {
  project: Project;
  switchboards: SwitchboardListItem[];
  currentUserId: string;
  isAdmin: boolean;
  revisionId: string;
  revisionArchived: boolean;
  onOpenSwitchboard: (switchboardId: string, tab?: Tab) => void;
  onSwitchboardDeleted: (switchboardId: string) => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [notes, setNotes] = useState(project.notes ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function saveNotes() {
    await supabase.from("projects").update({ notes: notes || null }).eq("id", project.id);
  }

  async function handleLockAndOpen(switchboardId: string, alreadyLockedByMe: boolean) {
    if (!alreadyLockedByMe) {
      setBusyId(switchboardId);
      const { error } = await supabase.rpc("lock_switchboard", { p_switchboard_id: switchboardId });
      setBusyId(null);
      if (error) {
        alert(error.message);
        return;
      }
    }
    onOpenSwitchboard(switchboardId, "bom");
    router.refresh();
  }

  async function handleRelease(switchboardId: string) {
    setBusyId(switchboardId);
    const { error } = await supabase.rpc("unlock_switchboard", { p_switchboard_id: switchboardId });
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function handleClone(switchboardId: string) {
    setBusyId(switchboardId);
    const { error } = await supabase.rpc("clone_switchboard", { p_switchboard_id: switchboardId });
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function handleDelete(switchboardId: string, tag: string) {
    if (!confirm(`Delete switchboard "${tag}"? This removes its whole BOM and GA layout. This can't be undone.`)) return;
    setBusyId(switchboardId);
    const { error } = await supabase.from("switchboards").delete().eq("id", switchboardId);
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    onSwitchboardDeleted(switchboardId);
  }

  async function handleAddSwitchboard() {
    const nextNum = switchboards.length + 1;
    const { error } = await supabase.from("switchboards").insert({
      revision_id: revisionId,
      tag: `SB-${String(nextNum).padStart(2, "0")}`,
      title: `Board ${nextNum}`,
      sort_order: switchboards.length,
    });
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="max-w-4xl space-y-6 px-8 py-6">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Project description</label>
        <textarea
          disabled={revisionArchived}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={4}
          placeholder="Scope, site details, special requirements..."
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-900">Switchboards</h2>
          {!revisionArchived && (
            <button
              onClick={handleAddSwitchboard}
              className="flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-500/60 hover:text-brand-600"
            >
              <Icon name="add" size={14} /> Add switchboard
            </button>
          )}
        </div>

        <div className="space-y-2">
          {switchboards.map((item) => {
            const sb = item.switchboard;
            const isLockedByMe = sb.locked_by === currentUserId;
            const isLockedByOther = sb.locked_by !== null && !isLockedByMe;
            const busy = busyId === sb.id;

            return (
              <div
                key={sb.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {sb.tag}
                      {sb.title ? `: ${sb.title}` : ""}
                    </span>
                    {isLockedByMe && (
                      <span className="flex items-center gap-1 rounded border border-emerald-200/60 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                        <Icon name="lock_open" size={11} /> Locked by you
                      </span>
                    )}
                    {isLockedByOther && (
                      <span className="flex items-center gap-1 rounded border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        <Icon name="lock" size={11} /> {item.lockedByName || "Locked"}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-slate-400">
                    {item.specSummary || "No spec set"} · {money(item.breakdown.mfgTotal)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {!revisionArchived && !isLockedByOther && (
                    <button
                      onClick={() => handleLockAndOpen(sb.id, isLockedByMe)}
                      disabled={busy}
                      className="rounded-md bg-brand-500 px-2.5 py-1 font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {isLockedByMe ? "Continue editing" : "Lock & Open"}
                    </button>
                  )}
                  {!revisionArchived && isLockedByOther && isAdmin && (
                    <button
                      onClick={() => handleRelease(sb.id)}
                      disabled={busy}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Force unlock
                    </button>
                  )}
                  {isLockedByMe && !revisionArchived && (
                    <button
                      onClick={() => handleRelease(sb.id)}
                      disabled={busy}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Release
                    </button>
                  )}
                  {!revisionArchived && (
                    <button
                      onClick={() => handleClone(sb.id)}
                      disabled={busy}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Clone
                    </button>
                  )}
                  {!revisionArchived && !isLockedByOther && (
                    <button
                      onClick={() => handleDelete(sb.id, sb.tag)}
                      disabled={busy}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {switchboards.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">
              No switchboards yet. Add one to start building its BOM and GA.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
