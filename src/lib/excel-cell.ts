// Text of an ExcelJS cell value as the user sees it in Excel. Besides plain
// strings/numbers, ExcelJS hands back objects for formula cells
// ({ formula, result }), rich text ({ richText: [...] }), hyperlinks
// ({ text, hyperlink }) and errors ({ error }) -- String() of those is
// "[object Object]", which once ended up as item descriptions.
export function excelCellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== "object") return String(v);
  const o = v as Record<string, unknown>;
  if ("result" in o || "formula" in o || "sharedFormula" in o) return excelCellText(o.result);
  if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
  if ("text" in o) return excelCellText(o.text);
  return ""; // { error: "#N/A" } and anything unknown
}
