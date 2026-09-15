"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";

export type SwitchboardNode = { id: string; tag: string; title: string | null; specSummary: string; cost: number };
export type RevisionNode = {
  id: string;
  revisionNumber: number;
  archived: boolean;
  isLatest: boolean;
  lockedByName: string | null;
  switchboards: SwitchboardNode[];
  cost: number;
};
export type ProjectNode = { id: string; code: string; title: string; revisions: RevisionNode[]; cost: number };
export type CustomerNode = { id: string; name: string; projects: ProjectNode[]; cost: number };

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

type Filter = "all" | "active" | "archived";

export function ProjectsTree({ customers }: { customers: CustomerNode[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(customers.map((c) => c.id)));

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return customers
      .map((c) => {
        const projects = c.projects
          .map((p) => {
            const revisions = p.revisions.filter((r) => {
              if (filter === "active" && r.archived) return false;
              if (filter === "archived" && !r.archived) return false;
              if (!q) return true;
              const haystack = [
                c.name,
                p.code,
                p.title,
                `rev ${r.revisionNumber}`,
                ...r.switchboards.map((s) => `${s.tag} ${s.title ?? ""}`),
              ]
                .join(" ")
                .toLowerCase();
              return haystack.includes(q);
            });
            return { ...p, revisions };
          })
          .filter((p) => p.revisions.length > 0);
        return { ...c, projects };
      })
      .filter((c) => c.projects.length > 0);
  }, [customers, filter, q]);

  const activeCount = customers.reduce((s, c) => s + c.projects.reduce((s2, p) => s2 + p.revisions.filter((r) => !r.archived).length, 0), 0);
  const archivedCount = customers.reduce((s, c) => s + c.projects.reduce((s2, p) => s2 + p.revisions.filter((r) => r.archived).length, 0), 0);

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
        <div className="flex items-center gap-1.5">
          <FilterPill label={`All ${activeCount + archivedCount}`} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterPill label={`Active ${activeCount}`} active={filter === "active"} onClick={() => setFilter("active")} />
          <FilterPill label={`Archived ${archivedCount}`} active={filter === "archived"} onClick={() => setFilter("archived")} />
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers, projects, revisions, switchboards..."
          className="w-80 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="divide-y divide-slate-100">
        {filtered.map((c) => (
          <div key={c.id}>
            <button
              onClick={() => toggle(c.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <Icon name={expanded.has(c.id) ? "expand_more" : "chevron_right"} size={16} className="text-slate-400" />
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[10px] font-medium text-white">
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="font-semibold text-slate-900">{c.name}</span>
              </span>
              <span className="text-sm text-slate-500">{money(c.cost)}</span>
            </button>
            {expanded.has(c.id) && (
              <div className="pb-1 pl-8">
                {c.projects.map((p) => (
                  <div key={p.id}>
                    <button
                      onClick={() => toggle(p.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-2">
                        <Icon name={expanded.has(p.id) ? "expand_more" : "chevron_right"} size={15} className="text-slate-400" />
                        <span className="font-mono text-xs text-slate-400">{p.code}</span>
                        <span className="text-sm font-medium text-slate-800">{p.title}</span>
                        <span className="text-xs text-slate-400">{p.revisions.length} revision(s)</span>
                      </span>
                      <span className="text-sm text-slate-500">{money(p.cost)}</span>
                    </button>
                    {expanded.has(p.id) && (
                      <div className="pb-1 pl-8">
                        {p.revisions.map((r) => (
                          <div key={r.id}>
                            <div className="flex w-full items-center justify-between gap-3 px-4 py-1.5">
                              <button onClick={() => toggle(r.id)} className="flex items-center gap-2 hover:opacity-80">
                                <Icon name={expanded.has(r.id) ? "expand_more" : "chevron_right"} size={14} className="text-slate-400" />
                                <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                                  Rev {r.revisionNumber}
                                </span>
                                {r.archived ? (
                                  <span className="rounded border border-rose-200/60 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                                    ARCHIVED
                                  </span>
                                ) : r.isLatest ? (
                                  <span className="rounded border border-emerald-200/60 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                                    ACTIVE
                                  </span>
                                ) : (
                                  <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                    Superseded
                                  </span>
                                )}
                                {r.lockedByName && (
                                  <span className="flex items-center gap-0.5 rounded border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                    <Icon name="lock" size={11} /> {r.lockedByName}
                                  </span>
                                )}
                                <span className="text-xs text-slate-400">{r.switchboards.length} switchboard(s)</span>
                              </button>
                              <span className="text-sm text-slate-500">{money(r.cost)}</span>
                            </div>
                            {expanded.has(r.id) && (
                              <div className="space-y-1 pb-2 pl-10">
                                {r.switchboards.map((sb) => (
                                  <Link
                                    key={sb.id}
                                    href={`/switchboards/${sb.id}/summary`}
                                    className="flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm hover:bg-slate-50"
                                  >
                                    <span>
                                      <span className="font-medium text-slate-800">
                                        {sb.tag}
                                        {sb.title ? `: ${sb.title}` : ""}
                                      </span>
                                      {sb.specSummary && <span className="ml-2 text-xs text-slate-400">{sb.specSummary}</span>}
                                    </span>
                                    <span className="text-slate-500">{money(sb.cost)}</span>
                                  </Link>
                                ))}
                                {r.switchboards.length === 0 && (
                                  <p className="px-3 py-1.5 text-xs text-slate-400">No switchboards yet.</p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <p className="px-4 py-8 text-center text-slate-400">No projects yet. Create one above.</p>}
      </div>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        active ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}
