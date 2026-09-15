"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

type Scope = {
  switchboardId: string;
  tag: string;
  title: string | null;
  revisionNumber: number;
  archived: boolean;
  lockedBy: string | null;
};

export function ActiveScopeCard() {
  const pathname = usePathname();
  const [scope, setScope] = useState<Scope | null | undefined>(undefined);

  const switchboardId = pathname.match(/^\/switchboards\/([^/]+)/)?.[1] ?? null;

  useEffect(() => {
    if (!switchboardId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("switchboards")
      .select("id, tag, title, revision:revisions(revision_number, archived, locked_by)")
      .eq("id", switchboardId)
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const row = data as unknown as {
          id: string;
          tag: string;
          title: string | null;
          revision: { revision_number: number; archived: boolean; locked_by: string | null };
        };
        setScope({
          switchboardId: row.id,
          tag: row.tag,
          title: row.title,
          revisionNumber: row.revision.revision_number,
          archived: row.revision.archived,
          lockedBy: row.revision.locked_by,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [switchboardId]);

  if (!switchboardId || !scope) return null;

  return (
    <div className="border-t border-slate-200/80 pt-5">
      <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Active Scope</div>
      <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            Rev {scope.revisionNumber}
          </span>
          {scope.archived && (
            <span className="rounded border border-rose-200/60 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
              ARCHIVED
            </span>
          )}
          {scope.lockedBy && (
            <span className="flex items-center gap-0.5 rounded border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              <Icon name="lock" size={11} /> Locked
            </span>
          )}
        </div>
        <div className="mb-2 line-clamp-1 text-xs font-medium text-slate-900" title={scope.tag}>
          {scope.tag}
          {scope.title ? `: ${scope.title}` : ""}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 pt-2 text-[11px]">
          <Link
            href={`/switchboards/${scope.switchboardId}/summary`}
            className={`font-medium ${pathname.endsWith("/summary") ? "text-brand-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Icon name="dashboard" size={13} className="mr-1 inline" />
            Summary
          </Link>
          <Link
            href={`/switchboards/${scope.switchboardId}/bom`}
            className={`font-medium ${pathname.endsWith("/bom") ? "text-brand-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Icon name="receipt_long" size={13} className="mr-1 inline" />
            BOM
          </Link>
          <Link
            href={`/switchboards/${scope.switchboardId}/ga`}
            className={`font-medium ${pathname.endsWith("/ga") ? "text-brand-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Icon name="grid_view" size={13} className="mr-1 inline" />
            GA
          </Link>
        </div>
      </div>
    </div>
  );
}
