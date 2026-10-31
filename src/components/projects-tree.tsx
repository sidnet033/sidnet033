"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { formatMoney, formatMoneyDual } from "@/lib/money";
import { NewProjectModal } from "@/components/new-project-modal";
import { useOnlineSwitchboards } from "@/lib/switchboard-presence";
import type { Customer, ProjectStage } from "@/types/database";

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
  stage: ProjectStage;
  engineer: string | null;
  createdAtLabel: string;
  revisions: RevisionNode[];
  cost: number;
  currency: string;
  exchangeRate: number;
};
function OnlineDot({ names }: { names: string[] | undefined }) {
  if (!names?.length) return null;
  const who = [...new Set(names)].join(", ");
  return (
    <span
      title={`Open now: ${who}`}
      aria-label={`Open now by ${who}`}
      className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle ring-2 ring-emerald-100"
    />
  );
}

export type CustomerNode = {
  id: string;
  name: string;
  projects: ProjectNode[];
  cost: number;
};

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

const STAGES: { id: ProjectStage; label: string; pill: string }[] = [
  { id: "new", label: "Yet to quote", pill: "bg-primary-fixed text-primary" },
  { id: "wip", label: "WIP", pill: "bg-primary-fixed text-primary" },
  { id: "quoted", label: "Quoted", pill: "bg-violet-100 text-violet-800" },
  {
    id: "finalization",
    label: "Finalization",
    pill: "bg-amber-100 text-amber-900",
  },
  { id: "won", label: "Won", pill: "bg-emerald-100 text-emerald-800" },
  { id: "lost", label: "Lost", pill: "bg-red-100 text-red-800" },
  {
    id: "hold",
    label: "Hold",
    pill: "bg-surface-container-high text-on-surface-variant",
  },
  {
    id: "budgetary",
    label: "Budgetary",
    pill: "bg-surface-container-high text-on-surface-variant",
  },
];
const stageOf = (id: ProjectStage) =>
  STAGES.find((s) => s.id === id) ?? STAGES[0];

type Status = "all" | "active" | "archived";
type Row = {
  project: ProjectNode;
  customer: CustomerNode;
  latest: RevisionNode | null;
};

// Projects list: a filter panel on the left (status, stage, customer) and
// one row per project; a row expands to its revisions and their
// switchboards, where the open / clone / delete actions live.
export function ProjectsTree({
  customers,
  customerOptions,
}: {
  customers: CustomerNode[];
  customerOptions: Customer[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [status, setStatus] = useState<Status>("active");
  const [stages, setStages] = useState<Set<ProjectStage>>(new Set());
  const [customerIds, setCustomerIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const online = useOnlineSwitchboards();

  const rows: Row[] = useMemo(
    () =>
      customers.flatMap((c) =>
        c.projects.map((p) => ({
          project: p,
          customer: c,
          latest: p.revisions.find((r) => r.isLatest) ?? p.revisions[0] ?? null,
        })),
      ),
    [customers],
  );

  const q = search.trim().toLowerCase();
  const visible = rows.filter(({ project: p, customer: c, latest }) => {
    if (status === "active" && latest?.archived) return false;
    if (status === "archived" && !latest?.archived) return false;
    if (stages.size && !stages.has(p.stage)) return false;
    if (customerIds.size && !customerIds.has(c.id)) return false;
    if (!q) return true;
    const hay = [
      c.name,
      p.code,
      p.title,
      ...p.revisions.flatMap((r) => [
        `rev ${r.revisionNumber}`,
        ...r.switchboards.map((s) => `${s.tag} ${s.title ?? ""}`),
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  const count = (fn: (r: Row) => boolean) => rows.filter(fn).length;
  const toggleIn = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  };
  const filtersOn =
    stages.size > 0 || customerIds.size > 0 || status !== "active" || !!q;

  async function cloneRevision(revisionId: string) {
    const { error } = await supabase.rpc("create_revision", {
      p_revision_id: revisionId,
    });
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function cloneSwitchboard(switchboardId: string) {
    const { error } = await supabase.rpc("clone_switchboard", {
      p_switchboard_id: switchboardId,
    });
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function deleteSwitchboard(switchboardId: string, label: string) {
    if (
      !confirm(
        `Delete switchboard "${label}"? This removes its whole BOM and GA layout. This can't be undone.`,
      )
    )
      return;
    const { error } = await supabase
      .from("switchboards")
      .delete()
      .eq("id", switchboardId);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-start gap-space-lg">
      <aside
        aria-label="Filters"
        className="w-full rounded-xl border border-surface-container-high bg-surface-container-lowest p-space-lg shadow-xs lg:w-60 lg:shrink-0"
      >
        <div className="mb-space-md flex items-center justify-between">
          <h2 className="text-[13px] font-bold text-on-surface">
            Filter projects by
          </h2>
          {filtersOn && (
            <button
              onClick={() => {
                setStatus("active");
                setStages(new Set());
                setCustomerIds(new Set());
                setSearch("");
              }}
              className="text-[12px] text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <FilterGroup title="Status">
          {(
            [
              ["active", "Active", count((r) => !r.latest?.archived)],
              ["archived", "Archived", count((r) => !!r.latest?.archived)],
              ["all", "All", rows.length],
            ] as [Status, string, number][]
          ).map(([id, label, n]) => (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-on-surface"
            >
              <input
                type="radio"
                name="status"
                checked={status === id}
                onChange={() => setStatus(id)}
                className="accent-primary"
              />
              <span className="flex-1">{label}</span>
              <span className="text-[12px] text-secondary">{n}</span>
            </label>
          ))}
        </FilterGroup>
        <FilterGroup title="Stage">
          {STAGES.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-on-surface"
            >
              <input
                type="checkbox"
                checked={stages.has(s.id)}
                onChange={() => toggleIn(stages, s.id, setStages)}
                className="accent-primary"
              />
              <span className="flex-1">{s.label}</span>
              <span className="text-[12px] text-secondary">
                {count((r) => r.project.stage === s.id)}
              </span>
            </label>
          ))}
        </FilterGroup>
        <FilterGroup title="Customer" last>
          {customers.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-on-surface"
            >
              <input
                type="checkbox"
                checked={customerIds.has(c.id)}
                onChange={() => toggleIn(customerIds, c.id, setCustomerIds)}
                className="accent-primary"
              />
              <span className="flex-1 truncate" title={c.name}>
                {c.name}
              </span>
              <span className="text-[12px] text-secondary">
                {c.projects.length}
              </span>
            </label>
          ))}
        </FilterGroup>
      </aside>

      <section className="min-w-0 flex-[999_1_640px]">
        <div className="mb-space-md flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex items-baseline gap-space-sm">
            <h1 className="text-[18px] font-bold text-on-surface">Projects</h1>
            <span className="text-[13px] text-secondary">
              {visible.length} of {rows.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <div className="relative">
              <Icon
                name="search"
                size={16}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects, customers, switchboards…"
                aria-label="Search projects"
                className="h-9 w-72 rounded-lg border border-outline-variant bg-surface-container-lowest pl-8 pr-3 text-[13px] text-on-surface shadow-xs placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <NewProjectModal customers={customerOptions} />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs">
          <table className="w-full min-w-[960px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-container-low text-left text-[12px] font-bold text-on-surface-variant">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5">Project</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Stage</th>
                <th className="px-3 py-2.5">Revision</th>
                <th className="px-3 py-2.5 text-right">Switchboards</th>
                <th className="px-3 py-2.5">Engineer</th>
                <th className="px-3 py-2.5">Created</th>
                <th className="px-3 py-2.5 text-right">Latest cost</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ project: p, customer: c, latest }) => {
                const isOpen = open.has(p.id);
                const st = stageOf(p.stage);
                return (
                  <Fragment key={p.id}>
                    <tr className="border-t border-surface-container-high transition-colors hover:bg-surface-container-low/60">
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => toggleIn(open, p.id, setOpen)}
                          aria-label={
                            isOpen ? `Collapse ${p.title}` : `Expand ${p.title}`
                          }
                          className="flex h-6 w-6 items-center justify-center rounded-md text-secondary hover:bg-surface-container"
                        >
                          <Icon
                            name={
                              isOpen ? "keyboard_arrow_down" : "chevron_right"
                            }
                            size={18}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        {latest ? (
                          <Link
                            href={`/revisions/${latest.id}`}
                            className="font-bold text-primary hover:underline"
                          >
                            {p.title}
                          </Link>
                        ) : (
                          <span className="font-bold">{p.title}</span>
                        )}
                        <OnlineDot
                          names={p.revisions.flatMap((r) =>
                            r.switchboards.flatMap(
                              (sb) => online.get(sb.id) ?? [],
                            ),
                          )}
                        />
                        <span className="ml-2 text-[12px] text-secondary">
                          {p.code}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{c.name}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${st.pill}`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {latest ? `Rev ${latest.revisionNumber}` : "—"}
                        {latest?.archived && (
                          <span className="ml-1.5 rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] text-on-surface-variant">
                            Archived
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {latest?.switchboards.length ?? 0}
                      </td>
                      <td className="px-3 py-2.5 text-on-surface-variant">
                        {p.engineer ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-on-surface-variant">
                        {p.createdAtLabel}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                        {latest
                          ? moneyDual(latest.cost, p.currency, p.exchangeRate)
                          : "—"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={8} className="px-3 pb-3 pt-0">
                          <div className="flex flex-col gap-space-sm border-l-2 border-surface-container-high pl-space-md">
                            {p.revisions.map((r) => (
                              <RevisionBlock
                                key={r.id}
                                revision={r}
                                project={p}
                                online={online}
                                onCloneRevision={cloneRevision}
                                onCloneSwitchboard={cloneSwitchboard}
                                onDeleteSwitchboard={deleteSwitchboard}
                              />
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-10 text-center text-secondary"
                  >
                    {rows.length === 0
                      ? "No projects yet — create one with New Project."
                      : "No projects match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FilterGroup({
  title,
  last,
  children,
}: {
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        last
          ? ""
          : "mb-space-md border-b border-surface-container-high pb-space-md"
      }
    >
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
        {title}
      </p>
      {children}
    </div>
  );
}

function RevisionBlock({
  revision: r,
  project: p,
  online,
  onCloneRevision,
  onCloneSwitchboard,
  onDeleteSwitchboard,
}: {
  revision: RevisionNode;
  project: ProjectNode;
  online: Map<string, string[]>;
  onCloneRevision: (revisionId: string) => void;
  onCloneSwitchboard: (switchboardId: string) => void;
  onDeleteSwitchboard: (switchboardId: string, label: string) => void;
}) {
  return (
    <div className={r.isLatest ? "" : "opacity-70"}>
      <div className="flex flex-wrap items-center justify-between gap-space-sm py-1.5">
        <div className="flex items-center gap-space-sm">
          <Link
            href={`/revisions/${r.id}`}
            className="font-bold text-on-surface hover:text-primary hover:underline"
          >
            Rev {r.revisionNumber}
          </Link>
          <span className="text-[12px] text-secondary">
            {r.archived ? "Archived" : r.isLatest ? "Latest" : "Superseded"}
          </span>
          <span className="text-[12px] text-secondary">·</span>
          <span className="text-[12px] text-secondary">{r.createdAtLabel}</span>
        </div>
        <div className="flex items-center gap-space-sm">
          <span className="font-bold tabular-nums">
            {moneyDual(r.cost, p.currency, p.exchangeRate)}
          </span>
          {r.isLatest && !r.archived && (
            <button
              onClick={() => onCloneRevision(r.id)}
              className="btn btn-outline btn-sm"
            >
              New revision (Rev {r.revisionNumber + 1})
            </button>
          )}
        </div>
      </div>
      {r.switchboards.length === 0 ? (
        <p className="pb-1 text-[12px] text-secondary">No switchboards yet.</p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-secondary">
              <th className="py-1 pr-3 font-bold">Switchboard</th>
              <th className="px-3 py-1 font-bold">Spec</th>
              <th className="px-3 py-1 font-bold">Bays</th>
              <th className="px-3 py-1 text-right font-bold">Cost</th>
              <th className="py-1 pl-3" />
            </tr>
          </thead>
          <tbody>
            {r.switchboards.map((sb) => {
              const label = `${sb.tag}${sb.title ? `: ${sb.title}` : ""}`;
              return (
                <tr
                  key={sb.id}
                  className="border-t border-surface-container-high"
                >
                  <td className="py-1.5 pr-3">
                    <span className="font-bold">{label}</span>
                    <OnlineDot names={online.get(sb.id)} />
                    {sb.lockedByName && (
                      <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                        <Icon name="lock" size={11} /> {sb.lockedByName}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-on-surface-variant">
                    {sb.specSummary || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-on-surface-variant">
                    {sb.bayCount}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {money(sb.cost)}
                  </td>
                  <td className="py-1.5 pl-3">
                    <div className="flex items-center justify-end gap-space-xs">
                      <Link
                        href={`/revisions/${r.id}?sb=${sb.id}&tab=bom`}
                        className="btn btn-primary btn-sm"
                      >
                        Open
                      </Link>
                      <button
                        onClick={() => onCloneSwitchboard(sb.id)}
                        title="Clone switchboard"
                        className="btn btn-outline btn-sm"
                      >
                        Clone
                      </button>
                      <button
                        onClick={() => onDeleteSwitchboard(sb.id, label)}
                        title="Delete switchboard"
                        aria-label={`Delete ${label}`}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-error-container hover:text-error"
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
