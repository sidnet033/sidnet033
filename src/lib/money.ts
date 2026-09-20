// All costs are stored and computed in INR (the company's base/purchasing
// currency, e.g. item_master.unit_cost). A project's currency + exchange_rate
// (see migration 0011) are used only to convert *display* of rolled-up
// project costs (Project Details, BOM Builder, GA Builder, Costing Summary)
// -- nothing is re-priced or stored in another currency. exchange_rate means
// "1 unit of the project currency = exchange_rate INR" (e.g. USD 83.45).
export function convertFromInr(amountInr: number, currency: string, exchangeRate: number): number {
  if (currency === "INR" || !exchangeRate) return amountInr;
  return amountInr / exchangeRate;
}

export function formatMoney(amountInr: number, currency: string = "INR", exchangeRate: number = 1): string {
  const converted = convertFromInr(amountInr, currency, exchangeRate);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(converted);
  } catch {
    return `${currency} ${converted.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
}

// For switchboard/project price displays only (Costing Summary, Project
// Detail, Dashboard rollups): show the base currency (INR) alongside the
// project's own currency, so nothing is hidden behind a conversion. When
// the project's currency already is INR, there's nothing to add.
export function formatMoneyDual(amountInr: number, currency: string, exchangeRate: number): string {
  const base = formatMoney(amountInr, "INR", 1);
  if (!currency || currency === "INR") return base;
  return `${base} (${formatMoney(amountInr, currency, exchangeRate)})`;
}
