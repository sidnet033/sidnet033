import type { RevisionContext } from "@/lib/revision-context";
import type { CostBreakdown } from "@/lib/switchboard-cost";
import type { ProjectStage } from "@/types/database";

export const STAGE_LABEL: Record<ProjectStage, string> = {
  new: "Yet to quote",
  wip: "WIP",
  quoted: "Quoted",
  finalization: "Finalization",
  won: "Won",
  lost: "Lost",
  hold: "Hold",
  budgetary: "Budgetary",
};

export const STAGE_TONE: Record<ProjectStage, string> = {
  new: "bg-surface-container-high text-on-surface-variant",
  wip: "bg-amber-100 text-amber-900",
  quoted: "bg-primary/10 text-primary",
  finalization: "bg-indigo-100 text-indigo-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-red-100 text-red-800",
  hold: "bg-surface-container-high text-on-surface-variant",
  budgetary: "bg-surface-container-high text-on-surface-variant",
};

export type SummaryBoard = {
  id: string;
  tag: string;
  title: string | null;
  description: string | null;
  typeName: string | null;
  std: string | null;
  form: string | null;
  amps: number | null;
  ip: string | null;
  ka: number | null;
  cableEntry: string | null;
  cableExit: string | null;
  busbar: string | null;
  neutralPct: number;
  qty: number;
  profitPct: number;
  breakdown: CostBreakdown;
  updatedAt: string;
  updatedByName: string | null;
  /** INR, per unit */
  unitCost: number;
  /** INR, per unit, cost + margin */
  unitPrice: number;
  /** INR, unitPrice x qty */
  totalPrice: number;
};

export type ProjectSummary = {
  revisionId: string;
  generatedAt: string;
  code: string;
  projectName: string;
  customerName: string | null;
  revisionNumber: number;
  revisionDate: string;
  archived: boolean;
  stage: ProjectStage;
  currency: string;
  exchangeRate: number;
  siblingRevisions: { id: string; revisionNumber: number }[];
  info: {
    createdBy: string | null;
    owner: string | null;
    crmEnquiryNumber: string | null;
    crmEnquiryDate: string | null;
    quoteRequiredBy: string | null;
    nature: string | null;
    site: string | null;
    siteAltitudeM: number | null;
    siteAmbientC: number | null;
    consultant: string | null;
    salesExec: string | null;
    busbarDensityCu: number;
    busbarDensityAl: number;
    busbarRateCu: number;
    busbarRateAl: number;
  };
  boards: SummaryBoard[];
  logistics: { label: string; amount: number; description: string | null }[];
  totals: {
    units: number;
    mfg: number;
    profit: number;
    tender: number;
    logistics: number;
    final: number;
    avgMarginPct: number;
    heads: {
      electrical: number;
      busbars: number;
      enclosure: number;
      wiring: number;
      assembly: number;
      testing: number;
    };
  };
};

export function buildProjectSummary(ctx: RevisionContext): ProjectSummary {
  const { project, revision, customer } = ctx;
  const boards: SummaryBoard[] = ctx.switchboards.map((s) => {
    const sb = s.switchboard;
    const unitCost = s.breakdown.mfgTotal;
    const unitPrice = unitCost * (1 + sb.profit_pct / 100);
    return {
      id: sb.id,
      tag: sb.tag,
      title: sb.title,
      description: sb.description,
      typeName: s.typeName,
      std: sb.std,
      form: sb.form_of_separation,
      amps: sb.amps,
      ip: sb.ip_rating,
      ka: sb.ka,
      cableEntry: sb.cable_entry,
      cableExit: sb.cable_exit,
      busbar: sb.busbar,
      neutralPct: sb.neutral_size_pct,
      qty: sb.qty,
      profitPct: sb.profit_pct,
      breakdown: s.breakdown,
      updatedAt: sb.updated_at,
      updatedByName: s.updatedByName,
      unitCost,
      unitPrice,
      totalPrice: unitPrice * sb.qty,
    };
  });
  const logistics = [
    {
      label: "Freight",
      amount: Number(revision.freight_amount) || 0,
      description: revision.freight_description,
    },
    {
      label: "Installation",
      amount: Number(revision.installation_amount) || 0,
      description: revision.installation_description,
    },
    {
      label: "Commissioning",
      amount: Number(revision.commissioning_amount) || 0,
      description: revision.commissioning_description,
    },
  ];
  const sum = (f: (b: SummaryBoard) => number) =>
    boards.reduce((s, b) => s + f(b), 0);
  const mfg = sum((b) => b.unitCost * b.qty);
  const tender = sum((b) => b.totalPrice);
  const logi = logistics.reduce((s, l) => s + l.amount, 0);
  return {
    revisionId: revision.id,
    generatedAt: new Date().toISOString(),
    code: project.code,
    projectName: project.title,
    customerName: customer?.name ?? revision.customer_name ?? null,
    revisionNumber: revision.revision_number,
    revisionDate: revision.created_at,
    archived: revision.archived,
    stage: project.stage,
    currency: project.currency,
    exchangeRate: Number(project.exchange_rate) || 1,
    siblingRevisions: ctx.siblingRevisions.map((r) => ({
      id: r.id,
      revisionNumber: r.revision_number,
    })),
    info: {
      createdBy: ctx.createdByName,
      owner: ctx.ownerName,
      crmEnquiryNumber: project.crm_enquiry_number,
      crmEnquiryDate: project.crm_enquiry_date,
      quoteRequiredBy: project.quote_required_by,
      nature: project.nature
        ? project.nature === "bidding"
          ? "Bidding"
          : "Purchase"
        : null,
      site: project.site_country,
      siteAltitudeM: project.site_altitude_m,
      siteAmbientC: project.site_ambient_temp_c,
      consultant: ctx.consultantName,
      salesExec: ctx.salesExecName,
      busbarDensityCu: Number(project.busbar_density_cu),
      busbarDensityAl: Number(project.busbar_density_al),
      busbarRateCu: Number(project.busbar_rate_cu),
      busbarRateAl: Number(project.busbar_rate_al),
    },
    boards,
    logistics,
    totals: {
      units: sum((b) => b.qty),
      mfg,
      profit: tender - mfg,
      tender,
      logistics: logi,
      final: tender + logi,
      avgMarginPct: boards.length
        ? boards.reduce((s, b) => s + b.profitPct, 0) / boards.length
        : 0,
      heads: {
        electrical: sum((b) => b.breakdown.electrical * b.qty),
        busbars: sum((b) => b.breakdown.busbars * b.qty),
        enclosure: sum((b) => b.breakdown.enclosure * b.qty),
        wiring: sum((b) => b.breakdown.wiringAmt * b.qty),
        assembly: sum((b) => b.breakdown.assemblyAmt * b.qty),
        testing: sum((b) => b.breakdown.testingAmt * b.qty),
      },
    },
  };
}

export function boardSpec(b: SummaryBoard): string {
  return [
    b.typeName,
    b.std,
    b.form ? `Form ${b.form.replace(/^form\s*/i, "")}` : null,
    b.amps ? `${b.amps}A` : null,
    b.ka ? `${b.ka}kA` : null,
    b.ip ? `IP${String(b.ip).replace(/^ip/i, "")}` : null,
    b.busbar ? `${b.busbar} busbar` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** plain-text money (PDF fonts have no ₹ glyph): "INR 1,23,456" */
export function moneyText(
  amountInr: number,
  currency = "INR",
  exchangeRate = 1,
): string {
  const v =
    currency === "INR" || !exchangeRate ? amountInr : amountInr / exchangeRate;
  return `${currency} ${Math.round(v).toLocaleString(
    currency === "INR" ? "en-IN" : "en-US",
  )}`;
}
