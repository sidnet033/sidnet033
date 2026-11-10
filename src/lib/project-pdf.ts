// Project summary PDFs, built on the phone / browser with jsPDF.
//  - internal: everything on the summary page, with costs and margins
//  - customer: project details, switchboards with spec / qty / price,
//    logistics and final price -- no costs, margins, rates or people
import type { jsPDF as JsPDF } from "jspdf";
import {
  STAGE_LABEL,
  boardSpec,
  fmtDate,
  moneyText,
  type ProjectSummary,
} from "@/lib/project-summary";

export type PdfKind = "internal" | "customer";

type Col = { title: string; w: number; align?: "left" | "right" | "center" };

const M = 14; // page margin, mm
const BLUE: [number, number, number] = [21, 75, 145];
const GREY: [number, number, number] = [110, 116, 125];
const LINE: [number, number, number] = [215, 219, 225];

class Doc {
  y = M;
  constructor(
    public pdf: JsPDF,
    private footer: string,
  ) {}
  get W() {
    return this.pdf.internal.pageSize.getWidth();
  }
  get H() {
    return this.pdf.internal.pageSize.getHeight();
  }
  ensure(h: number) {
    if (this.y + h > this.H - M - 6) {
      this.pdf.addPage();
      this.y = M;
    }
  }
  heading(t: string) {
    this.ensure(14);
    this.y += 3;
    this.pdf.setFont("helvetica", "bold").setFontSize(11.5);
    this.pdf.setTextColor(...BLUE);
    this.pdf.text(t, M, this.y);
    this.y += 1.8;
    this.pdf.setDrawColor(...BLUE).setLineWidth(0.4);
    this.pdf.line(M, this.y, this.W - M, this.y);
    this.y += 4.5;
    this.pdf.setTextColor(20, 20, 20);
  }
  /** label / value pairs, two per row */
  fields(pairs: [string, string][]) {
    const colW = (this.W - 2 * M) / 2;
    this.pdf.setFontSize(9);
    for (let i = 0; i < pairs.length; i += 2) {
      const row = pairs.slice(i, i + 2);
      const heights = row.map(([, v]) => {
        const lines = this.pdf.splitTextToSize(v || "—", colW - 46);
        return Math.max(1, lines.length) * 4;
      });
      const h = Math.max(...heights) + 1.5;
      this.ensure(h);
      row.forEach(([k, v], j) => {
        const x = M + j * colW;
        this.pdf.setFont("helvetica", "normal").setTextColor(...GREY);
        this.pdf.text(k, x, this.y);
        this.pdf.setFont("helvetica", "bold").setTextColor(20, 20, 20);
        this.pdf.text(
          this.pdf.splitTextToSize(v || "—", colW - 46),
          x + 44,
          this.y,
        );
      });
      this.y += h;
    }
    this.y += 1;
  }
  table(
    cols: Col[],
    rows: string[][],
    opts: { boldRows?: Set<number>; shadeRows?: Set<number> } = {},
  ) {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const scale = (this.W - 2 * M) / total;
    const ws = cols.map((c) => c.w * scale);
    const pad = 1.6;
    const drawHeader = () => {
      this.ensure(8);
      this.pdf.setFillColor(238, 241, 246);
      this.pdf.rect(M, this.y - 4, this.W - 2 * M, 6.5, "F");
      this.pdf.setFont("helvetica", "bold").setFontSize(8);
      this.pdf.setTextColor(...GREY);
      let x = M;
      cols.forEach((c, i) => {
        this.cell(c.title.toUpperCase(), x, ws[i], c.align, pad);
        x += ws[i];
      });
      this.y += 4.5;
      this.pdf.setTextColor(20, 20, 20);
    };
    drawHeader();
    rows.forEach((r, ri) => {
      this.pdf.setFontSize(8.5);
      this.pdf.setFont("helvetica", opts.boldRows?.has(ri) ? "bold" : "normal");
      const wrapped = r.map(
        (t, i) =>
          this.pdf.splitTextToSize(t ?? "", ws[i] - 2 * pad) as string[],
      );
      const h = Math.max(...wrapped.map((w) => w.length)) * 3.8 + 2;
      if (this.y + h > this.H - M - 6) {
        this.pdf.addPage();
        this.y = M;
        drawHeader();
        this.pdf.setFontSize(8.5);
        this.pdf.setFont(
          "helvetica",
          opts.boldRows?.has(ri) ? "bold" : "normal",
        );
      }
      if (opts.shadeRows?.has(ri)) {
        this.pdf.setFillColor(232, 240, 252);
        this.pdf.rect(M, this.y - 3.6, this.W - 2 * M, h, "F");
      }
      let x = M;
      wrapped.forEach((lines, i) => {
        lines.forEach((ln, k) =>
          this.cell(ln, x, ws[i], cols[i].align, pad, this.y + k * 3.8),
        );
        x += ws[i];
      });
      this.y += h;
      this.pdf.setDrawColor(...LINE).setLineWidth(0.2);
      this.pdf.line(M, this.y - 3.6, this.W - M, this.y - 3.6);
    });
    this.y += 2;
  }
  private cell(
    t: string,
    x: number,
    w: number,
    align: Col["align"] = "left",
    pad: number,
    y = this.y,
  ) {
    if (align === "right") this.pdf.text(t, x + w - pad, y, { align: "right" });
    else if (align === "center")
      this.pdf.text(t, x + w / 2, y, { align: "center" });
    else this.pdf.text(t, x + pad, y);
  }
  finish() {
    const n = this.pdf.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.pdf.setPage(i);
      this.pdf.setFont("helvetica", "normal").setFontSize(7.5);
      this.pdf.setTextColor(...GREY);
      this.pdf.text(this.footer, M, this.H - 7);
      this.pdf.text(`Page ${i} of ${n}`, this.W - M, this.H - 7, {
        align: "right",
      });
    }
  }
}

export async function buildProjectPdf(
  s: ProjectSummary,
  kind: PdfKind,
): Promise<{ blob: Blob; filename: string }> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const internal = kind === "internal";
  const cur = internal ? "INR" : s.currency;
  const money = (n: number) => moneyText(n, cur, s.exchangeRate);
  const generated = fmtDate(s.generatedAt);
  const d = new Doc(
    pdf,
    internal
      ? `INTERNAL — contains costs and margins. Do not share outside the company. ${s.code} Rev ${s.revisionNumber} · ${generated}`
      : `${s.code} Rev ${s.revisionNumber} · ${generated}`,
  );

  // title block
  pdf
    .setFont("helvetica", "bold")
    .setFontSize(16)
    .setTextColor(...BLUE);
  pdf.text(internal ? "Project Summary" : "Price Summary", M, d.y + 2);
  if (internal) {
    pdf.setFillColor(200, 30, 30);
    pdf.roundedRect(d.W - M - 26, d.y - 3.5, 26, 7, 1.5, 1.5, "F");
    pdf.setFontSize(8.5).setTextColor(255, 255, 255);
    pdf.text("INTERNAL", d.W - M - 13, d.y + 1.3, { align: "center" });
  }
  d.y += 8;
  pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(20, 20, 20);
  pdf.text(pdf.splitTextToSize(s.projectName || s.code, d.W - 2 * M), M, d.y);
  d.y += 5;
  pdf
    .setFont("helvetica", "normal")
    .setFontSize(9.5)
    .setTextColor(...GREY);
  pdf.text(
    [
      s.customerName,
      `${s.code} · Rev ${s.revisionNumber}`,
      internal ? `Stage: ${STAGE_LABEL[s.stage]}` : null,
      `Date: ${generated}`,
    ]
      .filter(Boolean)
      .join("   |   "),
    M,
    d.y,
  );
  d.y += 5;

  // project information
  d.heading("Project information");
  const i = s.info;
  const site = [
    i.site,
    i.siteAltitudeM != null ? `${i.siteAltitudeM} m altitude` : null,
    i.siteAmbientC != null ? `${i.siteAmbientC} °C ambient` : null,
  ]
    .filter(Boolean)
    .join(", ");
  d.fields(
    internal
      ? [
          ["Customer", s.customerName ?? "—"],
          ["Project code", s.code],
          ["Revision", `Rev ${s.revisionNumber} (${fmtDate(s.revisionDate)})`],
          ["Stage", STAGE_LABEL[s.stage]],
          ["CRM enquiry no.", i.crmEnquiryNumber ?? "—"],
          ["Enquiry date", fmtDate(i.crmEnquiryDate)],
          ["Quote required by", fmtDate(i.quoteRequiredBy)],
          ["Nature", i.nature ?? "—"],
          ["Site", site || "—"],
          ["Consultant", i.consultant ?? "—"],
          ["Sales exec", i.salesExec ?? "—"],
          ["Project owner", i.owner ?? "—"],
          ["Created by", i.createdBy ?? "—"],
          [
            "Currency",
            s.currency === "INR"
              ? "INR"
              : `${s.currency} (1 ${s.currency} = INR ${s.exchangeRate})`,
          ],
          [
            "Busbar density",
            `Cu ${i.busbarDensityCu} / Al ${i.busbarDensityAl} A/mm²`,
          ],
          [
            "Busbar rate",
            `Cu INR ${i.busbarRateCu}/kg · Al INR ${i.busbarRateAl}/kg`,
          ],
        ]
      : [
          ["Customer", s.customerName ?? "—"],
          ["Our reference", `${s.code} Rev ${s.revisionNumber}`],
          ["Project", s.projectName || "—"],
          ["Site", site || "—"],
          ["Consultant", i.consultant ?? "—"],
          ["Currency", s.currency],
        ],
  );

  // switchboards
  d.heading(`Switchboards (${s.boards.length})`);
  if (internal) {
    const rows = s.boards.map((b, n) => [
      String(n + 1),
      `${b.tag}${b.title ? `: ${b.title}` : ""}${b.description ? `\n${b.description}` : ""}`,
      [
        boardSpec(b),
        [
          b.cableEntry ? `Entry ${b.cableEntry}` : null,
          b.cableExit ? `Exit ${b.cableExit}` : null,
          `Neutral ${b.neutralPct}%`,
        ]
          .filter(Boolean)
          .join(" · "),
      ].join("\n"),
      String(b.qty),
      money(b.unitCost),
      `${b.profitPct}%`,
      money(b.totalPrice),
    ]);
    rows.push([
      "",
      "Total",
      "",
      String(s.totals.units),
      "",
      `${s.totals.avgMarginPct.toFixed(1)}% avg`,
      money(s.totals.tender),
    ]);
    d.table(
      [
        { title: "#", w: 6, align: "center" },
        { title: "Switchboard", w: 38 },
        { title: "Specification", w: 52 },
        { title: "Qty", w: 9, align: "center" },
        { title: "Unit cost", w: 26, align: "right" },
        { title: "Margin", w: 14, align: "right" },
        { title: "Total price", w: 26, align: "right" },
      ],
      rows,
      {
        boldRows: new Set([rows.length - 1]),
        shadeRows: new Set([rows.length - 1]),
      },
    );
  } else {
    const rows = s.boards.map((b, n) => [
      String(n + 1),
      `${b.tag}${b.title ? `: ${b.title}` : ""}${b.description ? `\n${b.description}` : ""}`,
      boardSpec(b),
      String(b.qty),
      money(b.unitPrice),
      money(b.totalPrice),
    ]);
    rows.push([
      "",
      "Total",
      "",
      String(s.totals.units),
      "",
      money(s.totals.tender),
    ]);
    d.table(
      [
        { title: "#", w: 6, align: "center" },
        { title: "Switchboard", w: 46 },
        { title: "Specification", w: 60 },
        { title: "Qty", w: 10, align: "center" },
        { title: "Unit price", w: 25, align: "right" },
        { title: "Amount", w: 27, align: "right" },
      ],
      rows,
      {
        boldRows: new Set([rows.length - 1]),
        shadeRows: new Set([rows.length - 1]),
      },
    );
  }

  // costing / price summary
  if (internal) {
    d.heading("Costing summary");
    const h = s.totals.heads;
    const rows: string[][] = [
      ["Electrical", money(h.electrical)],
      ["Busbars", money(h.busbars)],
      ["Enclosure", money(h.enclosure)],
      ["Wiring", money(h.wiring)],
      ["Assembly", money(h.assembly)],
      ["Testing", money(h.testing)],
      ["Total MFG cost", money(s.totals.mfg)],
      [
        `Profit (avg ${s.totals.avgMarginPct.toFixed(1)}%)`,
        money(s.totals.profit),
      ],
      ["Tender price", money(s.totals.tender)],
      ...s.logistics.map((l) => [
        `${l.label}${l.description ? ` — ${l.description}` : ""}`,
        money(l.amount),
      ]),
      ["Total logistics", money(s.totals.logistics)],
      ["FINAL PRICE", money(s.totals.final)],
    ];
    const bold = new Set([6, 8, rows.length - 2, rows.length - 1]);
    d.table(
      [
        { title: "Cost head", w: 120 },
        { title: "Amount (all switchboards)", w: 60, align: "right" },
      ],
      rows,
      { boldRows: bold, shadeRows: new Set([8, rows.length - 1]) },
    );
    if (s.boards.length > 1) {
      d.heading("Cost by switchboard (cost x qty)");
      const br = s.boards.map((b) => [
        `${b.tag}${b.qty > 1 ? ` x${b.qty}` : ""}`,
        money(b.breakdown.electrical * b.qty),
        money(b.breakdown.busbars * b.qty),
        money(b.breakdown.enclosure * b.qty),
        money(
          (b.breakdown.wiringAmt +
            b.breakdown.assemblyAmt +
            b.breakdown.testingAmt) *
            b.qty,
        ),
        money(b.unitCost * b.qty),
        money(b.totalPrice),
      ]);
      d.table(
        [
          { title: "Switchboard", w: 30 },
          { title: "Electrical", w: 25, align: "right" },
          { title: "Busbars", w: 25, align: "right" },
          { title: "Enclosure", w: 25, align: "right" },
          { title: "Labour", w: 23, align: "right" },
          { title: "MFG cost", w: 26, align: "right" },
          { title: "Tender", w: 26, align: "right" },
        ],
        br,
      );
    }
  } else {
    d.heading("Price summary");
    const rows: string[][] = [
      ["Switchboards (supply)", money(s.totals.tender)],
      ...s.logistics
        .filter((l) => l.amount > 0)
        .map((l) => [
          `${l.label}${l.description ? ` — ${l.description}` : ""}`,
          money(l.amount),
        ]),
      ["TOTAL PRICE", money(s.totals.final)],
    ];
    d.table(
      [
        { title: "Description", w: 120 },
        { title: `Amount (${s.currency})`, w: 60, align: "right" },
      ],
      rows,
      {
        boldRows: new Set([rows.length - 1]),
        shadeRows: new Set([rows.length - 1]),
      },
    );
  }

  d.finish();
  const safe = `${s.code}_Rev${s.revisionNumber}`.replace(
    /[^A-Za-z0-9_-]+/g,
    "_",
  );
  return {
    blob: pdf.output("blob"),
    filename: `${safe}_${internal ? "Internal" : "Customer"}.pdf`,
  };
}
