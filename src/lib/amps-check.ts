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
