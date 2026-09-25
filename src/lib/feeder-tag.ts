// FDR-{IG incomer / OG outgoing / ...}-{rated amps}-{make of the first
// device added}-{incrementing number, unique among feeders sharing the
// same type/amps/make prefix}. Used both for Feeder Master's live-editable
// code field and for auto-tagging a custom feeder the first time it's
// promoted to the library from BOM Builder.
export function typeCode(category: string): string {
  switch (category) {
    case "Incomer":
      return "IG";
    case "Outgoing":
      return "OG";
    case "Sub-Incomer":
      return "SI";
    case "Bus Coupler":
      return "BC";
    case "APFC Capacitor Bank":
      return "PFC";
    default:
      return "GEN";
  }
}

export function makeCode(make: string | null): string {
  return make ? make.trim().split(/\s+/)[0].toUpperCase() : "";
}

export function computeFeederTag(
  category: string,
  ratedCurrent: string,
  firstMake: string | null,
  existingFeeders: { id: string; tag: string | null }[],
  excludeId: string | null
): string {
  if (!category) return "FDR-—";
  const tCode = typeCode(category);
  if (!ratedCurrent) return `FDR-${tCode}-—`;
  const mCode = makeCode(firstMake);
  if (!mCode) return `FDR-${tCode}-${ratedCurrent}-—`;
  const prefix = `FDR-${tCode}-${ratedCurrent}-${mCode}-`;
  const seqs = existingFeeders
    .filter((f) => f.id !== excludeId && f.tag?.startsWith(prefix))
    .map((f) => Number(f.tag!.slice(prefix.length)))
    .filter((n) => !Number.isNaN(n));
  const seq = seqs.length ? Math.max(...seqs) + 1 : 1;
  return `${prefix}${seq}`;
}
