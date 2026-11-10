"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { queryGroups } from "@/lib/item-search";
import { Highlight } from "@/components/highlight";
import {
  STAGE_LABEL,
  STAGE_TONE,
  fmtDate,
  fmtUpdate,
  type LastUpdate,
} from "@/lib/project-summary";
import type { ProjectStage } from "@/types/database";

export type MobileProjectRow = {
  projectId: string;
  revisionId: string;
  revisionNumber: number;
  archived: boolean;
  lastUpdated: LastUpdate | null;
  code: string;
  title: string;
  customer: string | null;
  stage: ProjectStage;
  crm: string | null;
  site: string | null;
  quoteRequiredBy: string | null;
};

const STAGES: (ProjectStage | "all")[] = [
  "all",
  "new",
  "wip",
  "quoted",
  "finalization",
  "won",
  "lost",
  "hold",
  "budgetary",
];

export function MobileProjectList({ rows }: { rows: MobileProjectRow[] }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<ProjectStage | "all">("all");
  const [showArchived, setShowArchived] = useState(false);
  const groups = queryGroups(q);
  const terms = groups.flat();

  const shown = useMemo(() => {
    return rows
      .filter((r) => showArchived || !r.archived)
      .filter((r) => stage === "all" || r.stage === stage)
      .map((r) => {
        const h = [
          r.code,
          r.title,
          r.customer,
          r.crm,
          r.site,
          STAGE_LABEL[r.stage],
        ]
          .filter(Boolean)
          .join(" \u0000 ")
          .toLowerCase();
        return {
          r,
          score: groups.length
            ? groups.filter((g) => g.every((t) => h.includes(t))).length
            : 1,
        };
      })
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.r.lastUpdated?.at ?? "").localeCompare(a.r.lastUpdated?.at ?? ""),
      )
      .map((x) => x.r);
  }, [rows, groups, stage, showArchived]);

  const count = (s: ProjectStage | "all") =>
    rows.filter(
      (r) => (showArchived || !r.archived) && (s === "all" || r.stage === s),
    ).length;

  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-bold">Projects</h1>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search customer, project, code, CRM no…"
        className="h-11 w-full rounded-lg border border-surface-container-high bg-surface-container-lowest px-3 text-[15px] outline-none focus:ring-2 focus:ring-primary/30"
      />
      <p className="-mt-1 text-[11px] text-secondary">
        Use <b>|</b> for any word (abb|siemens), <b>+</b> for all words
        (hospital+mumbai).
      </p>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStage(s)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] ${
              stage === s
                ? "border-primary bg-primary text-on-primary"
                : "border-surface-container-high bg-surface-container-lowest"
            }`}
          >
            {s === "all" ? "All" : STAGE_LABEL[s]} ({count(s)})
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px] text-secondary">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Include archived revisions
      </label>

      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.projectId}>
            <Link
              href={`/m/r/${r.revisionId}`}
              className="block rounded-xl bg-surface-container-lowest p-3 shadow-sm active:bg-surface-container"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-secondary">
                  <Highlight text={r.customer ?? "No customer"} terms={terms} />
                </p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STAGE_TONE[r.stage]}`}
                >
                  {STAGE_LABEL[r.stage]}
                </span>
              </div>
              <p className="mt-0.5 text-[16px] font-bold leading-snug">
                <Highlight text={r.title || r.code} terms={terms} />
              </p>
              <p className="mt-1 text-[12px] text-secondary">
                <Highlight text={r.code} terms={terms} /> · Rev{" "}
                {r.revisionNumber}
                {r.archived && " · Archived"}
                {r.crm && (
                  <>
                    {" "}
                    · CRM <Highlight text={r.crm} terms={terms} />
                  </>
                )}
              </p>
              <p className="text-[12px] text-secondary">
                Updated {fmtUpdate(r.lastUpdated)}
              </p>
              {r.quoteRequiredBy && (
                <p className="text-[12px] text-secondary">
                  Quote required by {fmtDate(r.quoteRequiredBy)}
                </p>
              )}
            </Link>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="rounded-xl bg-surface-container-lowest p-6 text-center text-secondary">
            No projects match.
          </li>
        )}
      </ul>
    </div>
  );
}
