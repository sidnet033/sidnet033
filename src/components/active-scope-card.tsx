"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/types/database";
import { Icon } from "@/components/icon";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  quoted: "bg-blue-50 text-blue-700 border-blue-200/60",
  won: "bg-emerald-50 text-emerald-600 border-emerald-200/60",
  lost: "bg-rose-50 text-rose-600 border-rose-200/60",
};

export function ActiveScopeCard() {
  const pathname = usePathname();
  const [project, setProject] = useState<Project | null | undefined>(undefined);

  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single()
      .then(({ data }) => {
        if (!cancelled) setProject((data as Project) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId || !project) return null;

  return (
    <div className="border-t border-slate-200/80 pt-5">
      <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Active Scope
      </div>
      <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-xs">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${STATUS_STYLES[project.status]}`}
          >
            {project.status.toUpperCase()}
          </span>
        </div>
        <div className="mb-1 line-clamp-1 text-xs font-medium text-slate-900" title={project.name}>
          {project.name}
        </div>
        {project.customer_name && (
          <div className="mb-2 truncate text-[11px] text-slate-500">{project.customer_name}</div>
        )}
        <div className="flex items-center gap-3 border-t border-slate-100 pt-2 text-[11px]">
          <Link
            href={`/projects/${project.id}/ga`}
            className={`font-medium ${pathname.endsWith("/ga") ? "text-brand-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Icon name="grid_view" size={13} className="mr-1 inline" />
            GA Canvas
          </Link>
          <Link
            href={`/projects/${project.id}/costing`}
            className={`font-medium ${pathname.endsWith("/costing") ? "text-brand-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Icon name="payments" size={13} className="mr-1 inline" />
            Costing
          </Link>
        </div>
      </div>
    </div>
  );
}
