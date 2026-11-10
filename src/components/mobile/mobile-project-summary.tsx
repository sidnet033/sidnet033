"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoneyDual } from "@/lib/money";
import {
  STAGE_LABEL,
  STAGE_TONE,
  boardSpec,
  fmtDate,
  fmtDateTime,
  fmtUpdate,
  type ProjectSummary,
} from "@/lib/project-summary";
import type { PdfKind } from "@/lib/project-pdf";

export function MobileProjectSummary({
  summary: s,
}: {
  summary: ProjectSummary;
}) {
  const router = useRouter();
  const money = (n: number) => formatMoneyDual(n, s.currency, s.exchangeRate);
  const [busy, setBusy] = useState<PdfKind | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    filename: string;
    blob: Blob;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function makePdf(kind: PdfKind) {
    setBusy(kind);
    setError(null);
    try {
      const { buildProjectPdf } = await import("@/lib/project-pdf");
      const { blob, filename } = await buildProjectPdf(s, kind);
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ url: URL.createObjectURL(blob), filename, blob });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make the PDF.");
    } finally {
      setBusy(null);
    }
  }
  function download() {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview.url;
    a.download = preview.filename;
    a.click();
  }
  async function share() {
    if (!preview) return;
    const file = new File([preview.blob], preview.filename, {
      type: "application/pdf",
    });
    try {
      await navigator.share({ files: [file], title: preview.filename });
    } catch {
      /* cancelled */
    }
  }
  const canShare =
    typeof navigator !== "undefined" &&
    "canShare" in navigator &&
    preview != null &&
    navigator.canShare({
      files: [
        new File([preview.blob], preview.filename, { type: "application/pdf" }),
      ],
    });

  const i = s.info;
  const h = s.totals.heads;

  return (
    <div className="space-y-3">
      <Link href="/m" className="text-[13px] text-primary">
        ← Projects
      </Link>

      {/* header */}
      <section className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[14px] font-semibold text-secondary">
            {s.customerName ?? "No customer"}
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold ${STAGE_TONE[s.stage]}`}
          >
            {STAGE_LABEL[s.stage]}
          </span>
        </div>
        <h1 className="mt-0.5 text-[20px] font-bold leading-snug">
          {s.projectName || s.code}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-secondary">
          <span className="font-mono font-bold text-primary">{s.code}</span>
          {s.siblingRevisions.length > 1 ? (
            <select
              value={s.revisionId}
              onChange={(e) => router.push(`/m/r/${e.target.value}`)}
              className="rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-0.5"
            >
              {s.siblingRevisions.map((r) => (
                <option key={r.id} value={r.id}>
                  Rev {r.revisionNumber}
                </option>
              ))}
            </select>
          ) : (
            <span>Rev {s.revisionNumber}</span>
          )}
          {s.archived && <span>· Archived</span>}
        </div>
        <p className="mt-1 text-[12px] text-secondary">
          Last updated{" "}
          <span className="font-semibold text-on-surface">
            {fmtUpdate(s.lastUpdated)}
          </span>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Kpi label="Final price" value={money(s.totals.final)} strong />
          <Kpi
            label="Avg margin"
            value={`${s.totals.avgMarginPct.toFixed(1)}%`}
          />
        </div>
      </section>

      {/* PDFs */}
      <section className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
        <h2 className="mb-2 text-[15px] font-bold">PDF</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => makePdf("internal")}
            className="rounded-lg bg-primary px-3 py-2.5 text-[14px] font-semibold text-on-primary disabled:opacity-50"
          >
            {busy === "internal" ? "Making…" : "Internal PDF"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => makePdf("customer")}
            className="rounded-lg border border-primary px-3 py-2.5 text-[14px] font-semibold text-primary disabled:opacity-50"
          >
            {busy === "customer" ? "Making…" : "Customer PDF"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-secondary">
          Internal: everything incl. costs &amp; margins — not for customers.
          Customer: specs, quantities and selling prices only, in {s.currency}.
        </p>
        {error && <p className="mt-1 text-[12px] text-error">{error}</p>}
        {preview && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={download}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-[14px] font-semibold text-white"
              >
                Download{" "}
                {preview.filename.endsWith("Internal.pdf")
                  ? "internal"
                  : "customer"}{" "}
                PDF
              </button>
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-surface-container-high px-3 py-2 text-[14px]"
              >
                Open
              </a>
              {canShare && (
                <button
                  type="button"
                  onClick={share}
                  className="rounded-lg border border-surface-container-high px-3 py-2 text-[14px]"
                >
                  Share…
                </button>
              )}
            </div>
            <iframe
              title="PDF preview"
              src={preview.url}
              className="hidden h-[70vh] w-full rounded border border-surface-container-high md:block"
            />
          </div>
        )}
      </section>

      {/* project information */}
      <Section title="Project information">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
          <Info k="Revision date" v={fmtDate(s.revisionDate)} />
          <Info k="CRM enquiry no." v={i.crmEnquiryNumber} />
          <Info k="Enquiry date" v={fmtDate(i.crmEnquiryDate)} />
          <Info k="Quote required by" v={fmtDate(i.quoteRequiredBy)} />
          <Info k="Nature" v={i.nature} />
          <Info k="Site" v={i.site} />
          <Info
            k="Site altitude"
            v={i.siteAltitudeM != null ? `${i.siteAltitudeM} m` : null}
          />
          <Info
            k="Ambient temp"
            v={i.siteAmbientC != null ? `${i.siteAmbientC} °C` : null}
          />
          <Info k="Consultant" v={i.consultant} />
          <Info k="Sales exec" v={i.salesExec} />
          <Info k="Project owner" v={i.owner} />
          <Info k="Created by" v={i.createdBy} />
          <Info
            k="Currency"
            v={
              s.currency === "INR"
                ? "INR"
                : `${s.currency} (1 = INR ${s.exchangeRate})`
            }
          />
          <Info
            k="Busbar density"
            v={`Cu ${i.busbarDensityCu} · Al ${i.busbarDensityAl} A/mm²`}
          />
          <Info k="Busbar rate Cu" v={`₹${i.busbarRateCu}/kg`} />
          <Info k="Busbar rate Al" v={`₹${i.busbarRateAl}/kg`} />
        </dl>
      </Section>

      {/* switchboards */}
      <Section title={`Switchboards (${s.boards.length})`}>
        <ul className="space-y-2">
          {s.boards.map((b, n) => (
            <li
              key={b.id}
              className="rounded-lg border border-surface-container-high p-3"
            >
              <p className="text-[15px] font-bold">
                <span className="mr-1 text-[12px] font-normal text-secondary">
                  #{n + 1}
                </span>
                {b.tag}
                {b.title ? `: ${b.title}` : ""}
              </p>
              {b.description && (
                <p className="text-[12px] text-secondary">{b.description}</p>
              )}
              <p className="mt-1 text-[12px]">{boardSpec(b)}</p>
              <p className="text-[12px] text-secondary">
                {[
                  b.cableEntry && `Entry ${b.cableEntry}`,
                  b.cableExit && `Exit ${b.cableExit}`,
                  `Neutral ${b.neutralPct}%`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                <Info k="Qty" v={String(b.qty)} />
                <Info k="Unit cost" v={money(b.unitCost)} />
                <Info k="Margin" v={`${b.profitPct}%`} />
                <Info k="Total price" v={money(b.totalPrice)} strong />
                <Info
                  k="Updated"
                  v={`${fmtDateTime(b.updatedAt)}${b.updatedByName ? ` · ${b.updatedByName}` : ""}`}
                />
              </dl>
            </li>
          ))}
          {s.boards.length === 0 && (
            <li className="text-[13px] text-secondary">No switchboards yet.</li>
          )}
        </ul>
        {s.boards.length > 0 && (
          <div className="mt-2 flex justify-between border-t border-surface-container-high pt-2 text-[14px] font-bold">
            <span>{s.totals.units} units</span>
            <span className="text-primary">{money(s.totals.tender)}</span>
          </div>
        )}
      </Section>

      {/* costing summary */}
      <Section title="Costing summary">
        <table className="w-full text-[13px]">
          <tbody>
            <Row k="Electrical" v={money(h.electrical)} />
            <Row k="Busbars" v={money(h.busbars)} />
            <Row k="Enclosure" v={money(h.enclosure)} />
            <Row k="Wiring" v={money(h.wiring)} />
            <Row k="Assembly" v={money(h.assembly)} />
            <Row k="Testing" v={money(h.testing)} />
            <Row k="Total MFG cost" v={money(s.totals.mfg)} bold />
            <Row
              k={`Profit (avg ${s.totals.avgMarginPct.toFixed(1)}%)`}
              v={money(s.totals.profit)}
            />
            <Row k="Tender price" v={money(s.totals.tender)} bold shade />
            {s.logistics.map((l) => (
              <Row
                key={l.label}
                k={l.label}
                sub={l.description}
                v={money(l.amount)}
              />
            ))}
            <Row k="Total logistics" v={money(s.totals.logistics)} bold />
            <Row k="Final price" v={money(s.totals.final)} bold shade />
          </tbody>
        </table>
        {s.boards.length > 1 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-primary">
              By switchboard
            </summary>
            <ul className="mt-2 space-y-2">
              {s.boards.map((b) => (
                <li
                  key={b.id}
                  className="rounded-lg bg-surface-container-low p-2 text-[12px]"
                >
                  <p className="font-bold">
                    {b.tag}
                    {b.qty > 1 && ` × ${b.qty}`}
                  </p>
                  <p>
                    Electrical {money(b.breakdown.electrical * b.qty)} · Busbars{" "}
                    {money(b.breakdown.busbars * b.qty)} · Enclosure{" "}
                    {money(b.breakdown.enclosure * b.qty)} · Labour{" "}
                    {money(
                      (b.breakdown.wiringAmt +
                        b.breakdown.assemblyAmt +
                        b.breakdown.testingAmt) *
                        b.qty,
                    )}
                  </p>
                  <p className="font-semibold">
                    MFG {money(b.unitCost * b.qty)} → Tender{" "}
                    {money(b.totalPrice)}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Link
        href={`/revisions/${s.revisionId}`}
        className="block text-center text-[12px] text-secondary underline"
      >
        Open full project (desktop)
      </Link>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
      <h2 className="mb-2 text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-2.5 ${strong ? "bg-primary text-on-primary" : "bg-surface-container-low"}`}
    >
      <p
        className={`text-[11px] uppercase tracking-wide ${strong ? "text-on-primary/80" : "text-secondary"}`}
      >
        {label}
      </p>
      <p className="text-[16px] font-bold leading-tight break-words">{value}</p>
    </div>
  );
}

function Info({
  k,
  v,
  strong = false,
}: {
  k: string;
  v: string | null | undefined;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-secondary">{k}</dt>
      <dd
        className={`break-words ${strong ? "font-bold text-primary" : "font-medium"}`}
      >
        {v || "—"}
      </dd>
    </div>
  );
}

function Row({
  k,
  v,
  sub,
  bold = false,
  shade = false,
}: {
  k: string;
  v: string;
  sub?: string | null;
  bold?: boolean;
  shade?: boolean;
}) {
  return (
    <tr
      className={`border-t border-surface-container ${shade ? "bg-primary/10" : ""} ${bold ? "font-bold" : ""}`}
    >
      <td className="py-1.5 pr-2 pl-1">
        {k}
        {sub && (
          <span className="block text-[11px] font-normal text-secondary">
            {sub}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-1 text-right tabular-nums">{v}</td>
    </tr>
  );
}
