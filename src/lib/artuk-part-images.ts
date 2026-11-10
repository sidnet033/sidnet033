// Illustrations of ArTuK enclosure parts (public/artuk-parts). Exact part
// codes first; withdrawable ACB kits (KN...) share the KN2666-1IN drawing as
// a typical view.
export type PartImage = { src: string; caption: string; typical?: boolean };

const EXACT: Record<string, PartImage> = {
  "KN2666-1IN": {
    src: "/artuk-parts/acb-kit-kn2666.webp",
    caption: "Withdrawable ACB kit — exploded view (KN2666-1IN)",
  },
  "LF2010-1": {
    src: "/artuk-parts/lf2010-1.png",
    caption: "LF2010-1 — N°2 side panels IP65, 2000x900 (HxD) mm",
  },
  "PV2061-1": {
    src: "/artuk-parts/pv2061-1.png",
    caption: "PV2061-1 — Glass door IP65, 2000x600 (HxW) mm",
  },
  "SK2002-1": {
    src: "/artuk-parts/sk2002-1.png",
    caption: "SK2002-1 — N°2 segregated functional frames, H=2000 mm",
  },
  "SK2000-1": {
    src: "/artuk-parts/sk2000-sk6010.png",
    caption: "SK2000-1 — N°4 uprights, H=2000 mm (shown with SK6010-1)",
  },
  "SK6010-1": {
    src: "/artuk-parts/sk2000-sk6010.png",
    caption: "SK6010-1 — Top/Base set (shown with SK2000-1 uprights)",
  },
};

export function partImageOf(
  sku: string,
  description?: string | null,
): PartImage | null {
  const exact = EXACT[sku];
  if (exact) return exact;
  // withdrawable ACB kits; fixed-breaker kits (KN2066 ...) look different
  if (/^KN\d/.test(sku) && !/FIX/i.test(description ?? ""))
    return {
      ...EXACT["KN2666-1IN"],
      caption: `${sku} — typical withdrawable ACB kit (drawing shows KN2666-1IN)`,
      typical: true,
    };
  return null;
}
