"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { formatMoney, formatMoneyDual } from "@/lib/money";
import { NewProjectModal } from "@/components/new-project-modal";
import type { Customer } from "@/types/database";

export type SwitchboardNode = {
  id: string;
  tag: string;
  title: string | null;
  specSummary: string;
  bayCount: number;
  cost: number;
  lockedByName: string | null;
};
export type RevisionNode = {
  id: string;
  revisionNumber: number;
  archived: boolean;
  isLatest: boolean;
  createdAtLabel: string;
  switchboards: SwitchboardNode[];
  cost: number;
};
export type ProjectNode = {
  id: string;
  code: string;
  title: string;
  engineer: string | null;
  createdAtLabel: string;
  revisions: RevisionNode[];
  cost: number;
  currency: string;
  exchangeRate: number;
};
export type CustomerNode = { id: string; name: string; projects: ProjectNode[]; cost: number };

// Each project can have its own currency, so a project/revision/switchboard
// row shows both INR (base currency) and that project's own currency. A
// customer's rollup can span several projects with different currencies,
// so it stays INR-only rather than picking one project's currency arbitrarily.
function money(n: number) {
  return formatMoney(n, "INR", 1);
}
function moneyDual(n: number, currency: string, exchangeRate: number) {
  return formatMoneyDual(n, currency, exchangeRate);
}

const AVATAR_STYLES = [
  "bg-primary-container text-on-primary-container",
  "bg-secondary-container text-on-secondary-container",
  "bg-surface-container-high text-on-surface-variant",
  "bg-surface-container-high text-secondary",
];
const DOT_COLORS = ["bg-primary", "bg-tertiary", "bg-secondary"];

type Filter = "all" | "active" | "archived";

export function ProjectsTree({ customers, customerOptions }: { customers: CustomerNode[]; customerOptions: Customer[] }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(customers.map((c) => c.id)));

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  const allNodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const c of customers) {
      ids.push(c.id);
      for (const p of c.projects) {
        ids.push(p.id);
        for (const r of p.revisions) ids.push(r.id);
      }
    }
    return ids;
  }, [customers]);

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
  const allCount = activeCount + archivedCount;

  async function cloneRevision(revisionId: string) {
    const { error } = await supabase.rpc("create_revision", { p_revision_id: revisionId });
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function cloneSwitchboard(switchboardId: string) {
    const { error } = await supabase.rpc("clone_switchboard", { p_switchboard_id: switchboardId });
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function deleteSwitchboard(switchboardId: string, label: string) {
    if (!confirm(`Delete switchboard "${label}"? This removes its whole BOM and GA layout. This can't be undone.`)) return;
    const { error } = await supabase.from("switchboards").delete().eq("id", switchboardId);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Header Action Bar */}
      <div className="flex flex-col justify-between gap-space-md rounded-xl bg-surface-container-lowest p-space-lg shadow-sm xl:flex-row xl:items-center">
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-space-sm">
          <div className="flex items-center rounded-lg bg-surface-container-low p-space-2xs">
            <FilterPill label={`All Statuses (${allCount})`} active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterPill label={`Active (${activeCount})`} active={filter === "active"} onClick={() => setFilter("active")} />
            <FilterPill label={`Archived (${archivedCount})`} active={filter === "archived"} onClick={() => setFilter("archived")} />
          </div>
          <div className="hidden h-6 w-px bg-surface-container-high sm:block" />
          <div className="flex items-center gap-space-2xs">
            <button
              disabled
              title="Import bulk CSV specs — coming soon"
              className="flex items-center rounded-lg bg-surface-container-low p-space-xs text-secondary transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed"
            >
              <Icon name="upload_file" size={18} />
            </button>
            <button
              disabled
              title="Export hierarchy metadata — coming soon"
              className="flex items-center rounded-lg bg-surface-container-low p-space-xs text-secondary transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed"
            >
              <Icon name="file_download" size={18} />
            </button>
          </div>
          <NewProjectModal customers={customerOptions} />
        </div>
      </div>

      {/* Hierarchy Main Workspace */}
      <div className="flex flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="flex flex-col items-stretch justify-between gap-space-sm bg-surface-container-low p-space-md md:flex-row md:items-center">
          <div className="flex items-center gap-space-md">
            <div className="relative min-w-[280px] sm:min-w-[360px]">
              <Icon name="search" size={16} className="absolute left-space-sm top-1/2 -translate-y-1/2 text-secondary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customers, projects (PRJ-...), revisions, or switchboard tags..."
                className="h-8 w-full rounded bg-surface-container-lowest pl-8 pr-space-md font-body-sm text-body-sm text-on-surface placeholder:text-secondary shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="hidden items-center gap-space-xs font-label-sm text-label-sm text-secondary lg:flex">
              <Icon name="device_hub" size={14} />
              <span>Customer → Project → Revision → Switchboard</span>
            </div>
          </div>
          <div className="flex items-center gap-space-xs self-end md:self-auto">
            <button
              onClick={() => setExpanded(new Set(allNodeIds))}
              className="flex items-center gap-space-2xs rounded bg-surface-container px-space-sm py-space-2xs font-label-md text-label-md text-secondary transition-colors hover:text-on-surface"
            >
              <Icon name="unfold_more" size={14} />
              Expand All
            </button>
            <button
              onClick={() => setExpanded(new Set())}
              className="flex items-center gap-space-2xs rounded bg-surface-container px-space-sm py-space-2xs font-label-md text-label-md text-secondary transition-colors hover:text-on-surface"
            >
              <Icon name="unfold_less" size={14} />
              Collapse All
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 bg-surface-container-high px-space-md py-space-xs font-label-sm text-label-sm uppercase tracking-wider text-secondary">
          <div className="col-span-6 md:col-span-5">Project</div>
          <div className="col-span-3 text-right md:col-span-3">Total Cost</div>
          <div className="col-span-3 hidden md:col-span-2 md:block" />
          <div className="col-span-3 text-right md:col-span-2">Actions</div>
        </div>

        <div className="flex flex-col">
          {filtered.map((c, ci) => (
            <CustomerRow key={c.id} customer={c} index={ci} expanded={expanded} toggle={toggle} onCloneRevision={cloneRevision} onCloneSwitchboard={cloneSwitchboard} onDeleteSwitchboard={deleteSwitchboard} />
          ))}
          {filtered.length === 0 && <p className="px-space-md py-space-2xl text-center text-secondary">No projects yet. Create one above.</p>}
        </div>
      </div>
    </div>
  );
}

function CustomerRow({
  customer: c,
  index,
  expanded,
  toggle,
  onCloneRevision,
  onCloneSwitchboard,
  onDeleteSwitchboard,
}: {
  customer: CustomerNode;
  index: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onCloneRevision: (revisionId: string) => void;
  onCloneSwitchboard: (switchboardId: string) => void;
  onDeleteSwitchboard: (switchboardId: string, label: string) => void;
}) {
  const isOpen = expanded.has(c.id);
  const avatarStyle = AVATAR_STYLES[index % AVATAR_STYLES.length];

  return (
    <div className="flex flex-col bg-surface-container-lowest">
      <div
        onClick={() => toggle(c.id)}
        className="group grid cursor-pointer grid-cols-12 items-center px-space-md py-space-sm transition-colors hover:bg-surface-container-low"
      >
        <div className="col-span-6 flex min-w-0 items-center gap-space-sm md:col-span-5">
          <button className="flex h-6 w-6 items-center justify-center rounded text-secondary hover:bg-surface-container">
            <Icon name={isOpen ? "keyboard_arrow_down" : "chevron_right"} size={18} />
          </button>
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded font-telemetry-md text-telemetry-md ${avatarStyle}`}>
            {c.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-headline-sm text-headline-sm text-on-surface">{c.name}</span>
            <span className="font-body-sm text-body-sm text-secondary">
              {c.projects.length} Project{c.projects.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="col-span-3 text-right md:col-span-3">
          <span className="font-telemetry-lg text-telemetry-lg font-bold text-on-surface">{money(c.cost)}</span>
        </div>
      </div>
      {isOpen && (
        <div className="flex flex-col bg-surface-container-lowest pl-space-md sm:pl-space-xl">
          {c.projects.map((p) => (
            <ProjectRow key={p.id} project={p} expanded={expanded} toggle={toggle} onCloneRevision={onCloneRevision} onCloneSwitchboard={onCloneSwitchboard} onDeleteSwitchboard={onDeleteSwitchboard} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRow({
  project: p,
  expanded,
  toggle,
  onCloneRevision,
  onCloneSwitchboard,
  onDeleteSwitchboard,
}: {
  project: ProjectNode;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onCloneRevision: (revisionId: string) => void;
  onCloneSwitchboard: (switchboardId: string) => void;
  onDeleteSwitchboard: (switchboardId: string, label: string) => void;
}) {
  const isOpen = expanded.has(p.id);

  if (!isOpen) {
    return (
      <div
        onClick={() => toggle(p.id)}
        className="m-space-xs grid cursor-pointer grid-cols-12 items-center rounded-lg bg-surface-container-low/20 p-space-sm transition-colors hover:bg-surface-container-low"
      >
        <div className="col-span-6 flex min-w-0 items-center gap-space-sm md:col-span-5">
          <button className="flex h-5 w-5 items-center justify-center rounded text-secondary">
            <Icon name="chevron_right" size={18} />
          </button>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-space-xs">
              <span className="rounded bg-primary-fixed/30 px-space-xs py-0.5 font-telemetry-md text-telemetry-md text-primary">{p.code}</span>
              <span className="truncate font-headline-sm text-headline-sm text-on-surface">{p.title}</span>
            </div>
            <span className="font-label-md text-label-md text-secondary">
              {p.engineer ? `Engr: ${p.engineer} · ` : ""}
              {p.revisions.length} revision{p.revisions.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="col-span-3 text-right md:col-span-3">
          <span className="font-telemetry-lg text-telemetry-lg font-bold text-on-surface">{moneyDual(p.cost, p.currency, p.exchangeRate)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="m-space-xs flex flex-col rounded-lg bg-surface-container-low/40 p-space-xs shadow-sm">
      <div
        onClick={() => toggle(p.id)}
        className="grid cursor-pointer grid-cols-12 items-center rounded-lg p-space-sm transition-colors hover:bg-surface-container-low"
      >
        <div className="col-span-6 flex min-w-0 items-center gap-space-sm md:col-span-5">
          <button className="flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-surface-container">
            <Icon name="keyboard_arrow_down" size={18} />
          </button>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-space-xs">
              <span className="rounded bg-primary-fixed/30 px-space-xs py-0.5 font-telemetry-md text-telemetry-md text-primary">{p.code}</span>
              <span className="truncate font-headline-sm text-headline-sm text-on-surface">{p.title}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-space-sm font-label-md text-label-md text-secondary">
              {p.engineer && <span>Engr: {p.engineer}</span>}
              {p.engineer && <span>•</span>}
              <span>Date: {p.createdAtLabel}</span>
            </div>
          </div>
        </div>
        <div className="col-span-3 text-right md:col-span-3">
          <span className="font-telemetry-lg text-telemetry-lg font-bold text-primary">{moneyDual(p.cost, p.currency, p.exchangeRate)}</span>
          <span className="block font-label-sm text-label-sm text-secondary">
            {p.revisions.length} Revision{p.revisions.length === 1 ? "" : "s"} Registered
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-space-xs py-space-xs pl-space-md pr-space-xs sm:pl-space-xl">
        {p.revisions.map((r) => (
          <RevisionRow key={r.id} revision={r} project={p} expanded={expanded} toggle={toggle} onCloneRevision={onCloneRevision} onCloneSwitchboard={onCloneSwitchboard} onDeleteSwitchboard={onDeleteSwitchboard} />
        ))}
      </div>
    </div>
  );
}

function RevisionRow({
  revision: r,
  project: p,
  expanded,
  toggle,
  onCloneRevision,
  onCloneSwitchboard,
  onDeleteSwitchboard,
}: {
  revision: RevisionNode;
  project: ProjectNode;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onCloneRevision: (revisionId: string) => void;
  onCloneSwitchboard: (switchboardId: string) => void;
  onDeleteSwitchboard: (switchboardId: string, label: string) => void;
}) {
  const isOpen = expanded.has(r.id);

  if (!r.isLatest) {
    return (
      <div className="grid grid-cols-12 items-center rounded-lg p-space-xs text-secondary transition-colors hover:bg-surface-container-low">
        <div className="col-span-6 flex min-w-0 items-center gap-space-xs pl-space-xs md:col-span-5">
          <Icon name="history" size={16} />
          <span className="font-telemetry-md text-telemetry-md font-semibold text-on-surface-variant">Rev {r.revisionNumber}</span>
          <span className="hidden font-body-sm text-body-sm text-secondary sm:inline">· {r.createdAtLabel}</span>
        </div>
        <div className="col-span-3 text-right md:col-span-3">
          <span className="font-telemetry-md text-telemetry-md text-secondary line-through">{moneyDual(r.cost, p.currency, p.exchangeRate)}</span>
        </div>
        <div className="col-span-3 hidden items-center justify-center md:col-span-2 md:flex">
          <span className="font-label-sm text-label-sm text-secondary">{r.archived ? "ARCHIVED REV" : "SUPERSEDED"}</span>
        </div>
        <div className="col-span-3 flex items-center justify-end gap-space-xs md:col-span-2">
          <button
            disabled
            title="Compare diff coming soon"
            className="rounded bg-surface-container-low px-space-xs py-0.5 font-label-sm text-label-sm text-secondary disabled:cursor-not-allowed"
          >
            Compare Diff
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg bg-surface-container-lowest p-space-xs shadow-sm">
      <div
        onClick={() => toggle(r.id)}
        className="grid cursor-pointer grid-cols-12 items-center rounded p-space-xs transition-colors hover:bg-surface-container-low"
      >
        <div className="col-span-6 flex min-w-0 items-center gap-space-xs md:col-span-5">
          <button className="flex h-5 w-5 items-center justify-center rounded text-secondary hover:bg-surface-container">
            <Icon name={isOpen ? "keyboard_arrow_down" : "chevron_right"} size={18} />
          </button>
          <Icon name="verified" size={18} className="text-tertiary" />
          <div className="flex items-center gap-space-xs">
            <span className="font-telemetry-md text-telemetry-md font-bold text-on-surface">Rev {r.revisionNumber}</span>
            {!r.archived && (
              <span className="rounded bg-primary-fixed px-space-xs py-0.5 font-label-sm text-label-sm font-bold text-on-primary-fixed">ACTIVE</span>
            )}
          </div>
        </div>
        <div className="col-span-3 text-right md:col-span-3">
          <span className="font-telemetry-md text-telemetry-md font-bold text-on-surface">{moneyDual(r.cost, p.currency, p.exchangeRate)}</span>
          <span className="block font-label-sm text-label-sm text-secondary">
            {r.switchboards.length} Switchboard{r.switchboards.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="col-span-3 hidden md:col-span-2 md:block" />
        <div onClick={(e) => e.stopPropagation()} className="col-span-3 flex items-center justify-end gap-space-xs md:col-span-2">
          {!r.archived && (
            <button
              onClick={() => onCloneRevision(r.id)}
              className="rounded bg-surface-container-low px-space-xs py-0.5 font-label-sm text-label-sm text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
            >
              Clone Rev {r.revisionNumber + 1}
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="flex flex-col gap-space-xs py-space-xs pl-space-lg pr-space-xs sm:pl-space-xl">
          {r.switchboards.map((sb, si) => (
            <SwitchboardRow key={sb.id} switchboard={sb} revisionId={r.id} index={si} onClone={onCloneSwitchboard} onDelete={onDeleteSwitchboard} />
          ))}
          {r.switchboards.length === 0 && <p className="px-space-sm py-space-sm font-body-sm text-body-sm text-secondary">No switchboards yet.</p>}
        </div>
      )}
    </div>
  );
}

function SwitchboardRow({
  switchboard: sb,
  revisionId,
  index,
  onClone,
  onDelete,
}: {
  switchboard: SwitchboardNode;
  revisionId: string;
  index: number;
  onClone: (switchboardId: string) => void;
  onDelete: (switchboardId: string, label: string) => void;
}) {
  const dot = DOT_COLORS[index % DOT_COLORS.length];
  const label = `${sb.tag}${sb.title ? `: ${sb.title}` : ""}`;

  return (
    <div className="group grid grid-cols-12 items-center rounded bg-surface-container-low p-space-xs transition-colors hover:bg-surface-container">
      <div className="col-span-6 flex min-w-0 items-center gap-space-xs md:col-span-5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-space-xs">
            <span className="font-telemetry-md text-telemetry-md font-semibold text-on-surface">{label}</span>
            {sb.bayCount > 0 && (
              <span className="rounded bg-surface-container-highest px-space-xs py-0.5 font-label-sm text-label-sm text-primary">
                {sb.bayCount} Bay{sb.bayCount === 1 ? "" : "s"}
              </span>
            )}
            {sb.lockedByName && (
              <span className="flex items-center gap-0.5 rounded border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                <Icon name="lock" size={11} /> {sb.lockedByName}
              </span>
            )}
          </div>
          {sb.specSummary && <span className="truncate font-label-sm text-label-sm text-secondary">{sb.specSummary}</span>}
        </div>
      </div>
      <div className="col-span-3 text-right md:col-span-3">
        <span className="font-telemetry-md text-telemetry-md font-bold text-on-surface">{money(sb.cost)}</span>
      </div>
      <div className="col-span-3 hidden items-center justify-center md:col-span-1 md:flex" />
      <div className="col-span-3 flex items-center justify-end gap-space-xs md:col-span-3">
        <Link
          href={`/revisions/${revisionId}?sb=${sb.id}&tab=bom`}
          title="Open switchboard BOM/GA"
          className="flex items-center gap-space-2xs rounded bg-primary px-space-sm py-1 font-label-sm text-label-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-container"
        >
          <Icon name="launch" size={14} />
          Open
        </Link>
        <button
          onClick={() => onClone(sb.id)}
          title="Clone switchboard"
          className="flex items-center gap-space-2xs rounded bg-surface-container-lowest px-space-xs py-1 font-label-sm text-label-sm font-medium text-secondary shadow-sm transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <Icon name="content_copy" size={14} />
          <span className="hidden sm:inline">Clone</span>
        </button>
        <button
          onClick={() => onDelete(sb.id, label)}
          title="Delete switchboard"
          className="flex items-center justify-center rounded p-1 text-secondary transition-colors hover:bg-error-container hover:text-error"
        >
          <Icon name="delete" size={16} />
        </button>
      </div>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-space-sm py-space-2xs font-label-md text-label-md uppercase tracking-wider transition-colors ${
        active ? "bg-surface-container-lowest font-semibold text-primary shadow-sm" : "text-secondary hover:text-on-surface"
      }`}
    >
      {label}
    </button>
  );
}
