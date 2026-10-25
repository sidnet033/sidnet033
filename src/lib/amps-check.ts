import type { Feeder } from "@/types/database";

// Standard switchboard / breaker current ratings (A), used to suggest the
// next size up when a switchboard is rated below one of its feeders.
export const STANDARD_AMPS = [100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];

export function nextStandardAmps(amps: number): number {
  return STANDARD_AMPS.find((a) => a >= amps) ?? amps;
}

// Feeders rated above the switchboard they sit in (highest first). No
// switchboard rating = nothing to check against.
export function ampsViolations<F extends Pick<Feeder, "id" | "name" | "rated_current">>(switchboardAmps: number | null, feeders: F[]): F[] {
  if (switchboardAmps == null) return [];
  const seen = new Set<string>();
  return feeders
    .filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return f.rated_current != null && f.rated_current > switchboardAmps;
    })
    .sort((a, b) => b.rated_current! - a.rated_current!);
}

// Item categories that are a feeder's switching / protective device.
const SWITCHGEAR_CATEGORIES = ["ACB", "MCCB", "MCB", "SFU", "SWITCH DISCONNECTOR", "RCBO", "RCCB", "ATS", "COS"];
export function isSwitchgearCategory(category: string | null): boolean {
  return SWITCHGEAR_CATEGORIES.includes((category ?? "").trim().toUpperCase());
}

type SwitchgearItem = { category: string | null; amps: number | null; description: string };

// The feeder's main switchgear -- its highest-rated switching device, so a
// small control-circuit MCB alongside the main breaker isn't mistaken for it.
export function mainSwitchgear<I extends SwitchgearItem>(items: I[]): I | null {
  let best: I | null = null;
  for (const it of items) {
    if (!isSwitchgearCategory(it.category) || it.amps == null || it.amps <= 0) continue;
    if (!best || it.amps > best.amps!) best = it;
  }
  return best;
}

// Incomer, outgoing or bus coupler alike: the main switchgear can't be
// rated below the feeder. Returns it when it is (warning only).
export function switchgearBelowFeeder<I extends SwitchgearItem>(feederRating: number | null, items: I[]): I | null {
  if (feederRating == null || feederRating <= 0) return null;
  const main = mainSwitchgear(items);
  return main && main.amps! < feederRating ? main : null;
}

// A panel needs at least one incomer rated at or above its Amps. An
// incomer's rating is the feeder's rated current, else its main
// switchgear's. Returns the warning text, or null when one is.
export function incomerShortfall(switchboardAmps: number | null, incomers: { name: string; rating: number | null }[]): string | null {
  if (switchboardAmps == null || switchboardAmps <= 0) return null;
  if (incomers.length === 0) return `No incomer in the BOM — the panel is rated ${switchboardAmps}A and needs at least one incomer of ${switchboardAmps}A or more.`;
  if (incomers.some((i) => i.rating != null && i.rating >= switchboardAmps)) return null;
  const list = incomers.map((i) => `${i.name} ${i.rating != null ? `${i.rating}A` : "(no rating)"}`).join(", ");
  return `No incomer is rated ${switchboardAmps}A or more (the panel's Amps) — incomers: ${list}. Raise an incomer to at least ${switchboardAmps}A or lower the panel's Amps.`;
}
