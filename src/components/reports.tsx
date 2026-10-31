"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSwitchboardCostBreakdown } from "@/lib/switchboard-cost";
import type { ProjectStage, Switchboard } from "@/types/database";

// Reports: a side list of reports, the selected one on the right. Each
// report runs only when the user clicks "Show Report".
const REPORTS = [
  { id: "enquiries-by-status", label: "Enquiries by status" },
  { id: "value-by-sales-exec", label: "Enquiry value by sales exec" },
] as const;
type ReportId = (typeof REPORTS)[number]["id"];

const STAGE_ORDER: { id: ProjectStage; label: string }[] = [
  { id: "new", label: "Yet to quote" },
  { id: "wip", label: "WIP" },
  { id: "quoted", label: "Quoted" },
  { id: "finalization", label: "Finalization" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
  { id: "hold", label: "Hold" },
  { id: "budgetary", label: "Budgetary" },
];

type Measure = "count" | "value";

// ₹ in Indian units: 1.2 Cr, 35.4 L, 82 K
function inrShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(a >= 1e8 ? 0 : 2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)} K`;
  return `₹${Math.round(n)}`;
}
function inrFull(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function isoDay(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function ReportsHome() {
  const [active, setActive] = useState<ReportId>("enquiries-by-status");
  return (
    <div className="flex min-h-[calc(100vh-52px)]">
      <aside className="w-56 shrink-0 border-r border-surface-container-high bg-surface-container-lowest p-space-md">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-secondary">
          Reports
        </p>
        <nav className="flex flex-col gap-0.5">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              onClick={() => setActive(r.id)}
              className={`rounded-md px-2.5 py-1.5 text-left text-[13px] ${
                active === r.id
                  ? "bg-primary/10 font-bold text-primary"
                  : "text-on-surface hover:bg-surface-container-low"
              }`}
            >
              {r.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-space-lg">
        {active === "enquiries-by-status" && (
          <EnquiryReport key="status" groupBy="stage" defaultMeasure="count" />
        )}
        {active === "value-by-sales-exec" && (
          <EnquiryReport
            key="exec"
            groupBy="salesExec"
            defaultMeasure="value"
          />
        )}
      </main>
    </div>
  );
}

type Result = {
  measure: Measure;
  includeRevisions: boolean;
  from: string;
  to: string;
  groupBy: GroupBy;
  counts: { id: string; label: string; count: number }[];
  total: number;
};

type GroupBy = "stage" | "salesExec";
const UNASSIGNED = "__none__";

// One report engine, grouped either by status or by sales exec.
function EnquiryReport({
  groupBy,
  defaultMeasure,
}: {
  groupBy: GroupBy;
  defaultMeasure: Measure;
}) {
  const today = new Date();
  const [from, setFrom] = useState(
    isoDay(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
  );
  const [to, setTo] = useState(isoDay(today));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [measure, setMeasure] = useState<Measure>(defaultMeasure);
  const [includeRevisions, setIncludeRevisions] = useState(false);

  async function run() {
    if (from && to && from > to) {
      setError("The From date is after the To date.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [{ data: projects, error }, { data: revs, error: revErr }] =
        await Promise.all([
          supabase
            .from("projects")
            .select("id, stage, sales_exec_id, crm_enquiry_date, created_at"),
          supabase
            .from("revisions")
            .select("id, project_id, revision_number, created_at"),
        ]);
      if (error) throw error;
      if (revErr) throw revErr;
      const revsByProject = new Map<
        string,
        { id: string; n: number; created_at: string }[]
      >();
      for (const r of revs ?? []) {
        const list = revsByProject.get(r.project_id as string) ?? [];
        list.push({
          id: r.id as string,
          n: r.revision_number as number,
          created_at: r.created_at as string,
        });
        revsByProject.set(r.project_id as string, list);
      }

      // What gets counted. Without revisions: one per project, dated by its
      // CRM enquiry date (or creation date), valued at its latest revision.
      // With revisions: every revision -- the first dated like the project,
      // later ones by the day they were made -- each valued on its own.
      type Unit = {
        group: string;
        day: string;
        revisionId: string | null;
      };
      const units: Unit[] = [];
      for (const p of projects ?? []) {
        const projectDay =
          (p.crm_enquiry_date as string | null) ??
          isoDay(new Date(p.created_at as string));
        const group =
          groupBy === "stage"
            ? (p.stage as string)
            : ((p.sales_exec_id as string | null) ?? UNASSIGNED);
        const list = (revsByProject.get(p.id as string) ?? []).sort(
          (x, y) => x.n - y.n,
        );
        if (includeRevisions && list.length) {
          list.forEach((r, i) =>
            units.push({
              group,
              day: i === 0 ? projectDay : isoDay(new Date(r.created_at)),
              revisionId: r.id,
            }),
          );
        } else {
          units.push({
            group,
            day: projectDay,
            revisionId: list.length ? list[list.length - 1].id : null,
          });
        }
      }
      const inRange = units.filter(
        (u) => !((from && u.day < from) || (to && u.day > to)),
      );

      // value = quoted price of the revision (switchboard cost + margin, times qty), INR
      const valueByRevision = new Map<string, number>();
      const revisionIds = [
        ...new Set(
          inRange.map((u) => u.revisionId).filter((v): v is string => !!v),
        ),
      ];
      if (measure === "value" && revisionIds.length) {
        const { data: sbs, error: sbErr } = await supabase
          .from("switchboards")
          .select("*")
          .in("revision_id", revisionIds);
        if (sbErr) throw sbErr;
        const boards = (sbs ?? []) as Switchboard[];
        const breakdowns = await Promise.all(
          boards.map((sb) => getSwitchboardCostBreakdown(supabase, sb)),
        );
        boards.forEach((sb, i) => {
          const unit = breakdowns[i].mfgTotal;
          const price =
            (unit + unit * (Number(sb.profit_pct) / 100)) * Number(sb.qty);
          valueByRevision.set(
            sb.revision_id,
            (valueByRevision.get(sb.revision_id) ?? 0) + price,
          );
        });
      }

      const tally = new Map<string, number>();
      for (const u of inRange) {
        const add =
          measure === "count"
            ? 1
            : u.revisionId
              ? (valueByRevision.get(u.revisionId) ?? 0)
              : 0;
        tally.set(u.group, (tally.get(u.group) ?? 0) + add);
      }
      let counts: Result["counts"];
      if (groupBy === "stage") {
        counts = STAGE_ORDER.map((s) => ({
          ...s,
          count: tally.get(s.id) ?? 0,
        }));
      } else {
        // every sales exec, biggest first; enquiries with none go last
        const { data: execs, error: execErr } = await supabase
          .from("sales_execs")
          .select("id, name");
        if (execErr) throw execErr;
        counts = (execs ?? [])
          .map((x) => ({
            id: x.id as string,
            label: x.name as string,
            count: tally.get(x.id as string) ?? 0,
          }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        if (tally.get(UNASSIGNED))
          counts.push({
            id: UNASSIGNED,
            label: "No sales exec",
            count: tally.get(UNASSIGNED)!,
          });
      }
      setResult({
        measure,
        includeRevisions,
        groupBy,
        from,
        to,
        counts,
        total: counts.reduce((a, c) => a + c.count, 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-space-md">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-on-surface">
          {groupBy === "stage"
            ? "Enquiries by status"
            : "Enquiry value by sales exec"}
        </h1>
        <p className="text-[12px] text-secondary">
          {groupBy === "stage"
            ? "Enquiries (projects) in each status"
            : "Enquiries (projects) handled by each sales exec"}
          , by count or by value. Value is the quoted price (cost + margin ×
          qty, INR) of each project&apos;s latest revision, dated by CRM enquiry
          date (or the date the project was created). Tick &quot;Include
          revisions&quot; to count every revision as an enquiry: each adds its
          own value, and later revisions are dated by the day they were made.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-space-sm rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
        <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 rounded border border-surface-container-high px-2 text-[13px] font-normal normal-case tracking-normal text-on-surface"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 rounded border border-surface-container-high px-2 text-[13px] font-normal normal-case tracking-normal text-on-surface"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
          Show
          <select
            value={measure}
            onChange={(e) => setMeasure(e.target.value as Measure)}
            className="h-8 rounded border border-surface-container-high px-2 text-[13px] font-normal normal-case tracking-normal text-on-surface"
          >
            <option value="count">Enquiry count</option>
            <option value="value">Enquiry value</option>
          </select>
        </label>
        <label className="flex h-8 items-center gap-1.5 text-[13px] text-on-surface">
          <input
            type="checkbox"
            checked={includeRevisions}
            onChange={(e) => setIncludeRevisions(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Include revisions
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="btn btn-primary h-8"
        >
          {loading ? "Loading..." : "Show Report"}
        </button>
        {error && <p className="text-[12px] text-error">{error}</p>}
      </div>

      {result ? (
        <div className="rounded-xl bg-surface-container-lowest p-space-lg shadow-sm">
          <div className="mb-space-md flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] text-secondary">
              <span className="font-display text-[22px] font-black text-on-surface">
                {result.measure === "count"
                  ? result.total
                  : inrShort(result.total)}
              </span>{" "}
              {result.measure === "count"
                ? `enquir${result.total === 1 ? "y" : "ies"}`
                : "total enquiry value"}
              {result.includeRevisions ? " (each revision counted)" : ""} ·{" "}
              {fmt(result.from)} – {fmt(result.to)}
            </p>
            <button
              onClick={() => setShowTable((v) => !v)}
              className="text-[12px] text-primary hover:underline"
            >
              {showTable ? "Show chart" : "Show as table"}
            </button>
          </div>
          {showTable ? (
            <CountsTable result={result} />
          ) : result.groupBy === "stage" ? (
            <BarChart result={result} />
          ) : (
            <HBarChart result={result} />
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-surface-container-high py-12 text-center text-[13px] text-secondary">
          Pick a date range and click Show Report.
        </p>
      )}
    </div>
  );
}

function fmt(day: string) {
  return day
    ? new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
}

// Single series, so one hue and no legend; value labels sit above each bar,
// a tooltip gives the share on hover.
function BarChart({ result }: { result: Result }) {
  const [hover, setHover] = useState<number | null>(null);
  const isValue = result.measure === "value";
  const short = (n: number) => (isValue ? inrShort(n) : String(n));
  const max = Math.max(1, ...result.counts.map((c) => c.count));
  const ticks = useMemo(() => {
    // a "nice" step: 1, 2 or 5 x 10^n
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? raw;
    const step = isValue ? nice : Math.max(1, Math.ceil(nice));
    const out: number[] = [];
    for (let v = 0; v <= max; v += step) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }, [max, isValue]);
  const top = ticks[ticks.length - 1];
  const H = 240;

  return (
    <div className="relative">
      <div className="flex">
        <div
          className={`relative shrink-0 ${isValue ? "w-16" : "w-8"}`}
          style={{ height: H }}
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-secondary"
              style={{ top: H - (t / top) * H }}
            >
              {short(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height: H }}>
          {ticks.map((t) => (
            <div
              key={t}
              className={`absolute inset-x-0 border-t ${t === 0 ? "border-outline-variant" : "border-surface-container"}`}
              style={{ top: H - (t / top) * H }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px] px-1">
            {result.counts.map((c, i) => {
              const h = (c.count / top) * H;
              const share = result.total
                ? Math.round((c.count / result.total) * 100)
                : 0;
              return (
                <div
                  key={c.id}
                  className="relative flex h-full flex-1 cursor-default items-end justify-center"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  aria-label={`${c.label}: ${c.count}`}
                >
                  <div
                    className="relative w-full max-w-14"
                    style={{ height: h }}
                  >
                    <span className="absolute inset-x-0 -top-5 text-center text-[12px] font-bold tabular-nums text-on-surface">
                      {short(c.count)}
                    </span>
                    <div
                      className={`h-full rounded-t-[4px] ${hover === i ? "bg-primary-container" : "bg-primary"}`}
                    />
                  </div>
                  {hover === i && (
                    <div
                      className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-inverse-surface px-2 py-1 text-[12px] text-inverse-on-surface shadow-md"
                      style={{ bottom: h + 24 }}
                    >
                      <b>{c.label}</b>:{" "}
                      {isValue
                        ? inrFull(c.count)
                        : `${c.count} enquir${c.count === 1 ? "y" : "ies"}`}{" "}
                      ({share}%)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className={`mt-1 flex gap-[2px] px-1 ${isValue ? "ml-16" : "ml-8"}`}>
        {result.counts.map((c) => (
          <span
            key={c.id}
            className="flex-1 text-center text-[12px] text-on-surface-variant"
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function CountsTable({ result }: { result: Result }) {
  return (
    <table className="w-full max-w-md border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-surface-container-high text-left text-[11px] font-bold uppercase tracking-wider text-secondary">
          <th className="py-1.5">
            {result.groupBy === "stage" ? "Status" : "Sales exec"}
          </th>
          <th className="py-1.5 text-right">
            {result.measure === "count" ? "Enquiries" : "Value (INR)"}
          </th>
          <th className="py-1.5 text-right">Share</th>
        </tr>
      </thead>
      <tbody>
        {result.counts.map((c) => (
          <tr key={c.id} className="border-b border-surface-container">
            <td className="py-1.5">{c.label}</td>
            <td className="py-1.5 text-right tabular-nums">
              {result.measure === "count" ? c.count : inrFull(c.count)}
            </td>
            <td className="py-1.5 text-right tabular-nums text-secondary">
              {result.total ? Math.round((c.count / result.total) * 100) : 0}%
            </td>
          </tr>
        ))}
        <tr className="font-bold">
          <td className="py-1.5">Total</td>
          <td className="py-1.5 text-right tabular-nums">
            {result.measure === "count" ? result.total : inrFull(result.total)}
          </td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

// Horizontal bars for a list of names: one hue, biggest first, value at the
// end of each bar, share on hover.
function HBarChart({ result }: { result: Result }) {
  const [hover, setHover] = useState<number | null>(null);
  const isValue = result.measure === "value";
  const max = Math.max(1, ...result.counts.map((c) => c.count));
  if (result.counts.length === 0)
    return (
      <p className="text-[13px] text-secondary">No sales execs set up yet.</p>
    );
  return (
    <div className="space-y-1.5">
      {result.counts.map((c, i) => {
        const share = result.total
          ? Math.round((c.count / result.total) * 100)
          : 0;
        return (
          <div
            key={c.id}
            className="relative grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-3"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className={`truncate text-right text-[13px] ${c.id === UNASSIGNED ? "italic text-secondary" : "text-on-surface"}`}
              title={c.label}
            >
              {c.label}
            </span>
            <div className="flex h-6 items-center gap-2">
              <div
                className={`h-full rounded-r-[4px] ${hover === i ? "bg-primary-container" : "bg-primary"}`}
                style={{
                  width: `${(c.count / max) * 85}%`,
                  minWidth: c.count > 0 ? 2 : 0,
                }}
              />
              <span className="whitespace-nowrap text-[12px] font-bold tabular-nums text-on-surface">
                {isValue ? inrShort(c.count) : c.count}
              </span>
            </div>
            {hover === i && (
              <div className="pointer-events-none absolute left-[calc(min(14rem,40%)+1rem)] top-full z-10 mt-0.5 whitespace-nowrap rounded-md bg-inverse-surface px-2 py-1 text-[12px] text-inverse-on-surface shadow-md">
                <b>{c.label}</b>:{" "}
                {isValue
                  ? inrFull(c.count)
                  : `${c.count} enquir${c.count === 1 ? "y" : "ies"}`}{" "}
                ({share}%)
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
