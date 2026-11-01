"use client";

import { Icon } from "@/components/icon";

export const MRP_LP_HELP =
  "MRP = the discounted (net) price — no further discount is applied. LP = list price — a discount % is applied to it to get the net price.";

// Info icon shown next to every "MRP or LP" label: hover or focus shows
// what the two mean.
export function MrpLpInfo() {
  return (
    <span
      className="group relative inline-flex align-middle"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={MRP_LP_HELP}
        className="text-secondary hover:text-primary focus:text-primary focus:outline-none"
      >
        <Icon name="info" size={13} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 hidden w-64 -translate-x-1/2 whitespace-normal rounded-md bg-inverse-surface px-2.5 py-1.5 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-inverse-on-surface shadow-md group-hover:block group-focus-within:block"
      >
        <b>MRP</b> is the discounted (net) price — no further discount is
        applied.
        <br />
        <b>LP</b> is the list price — a discount % is applied to it to get the
        net price.
      </span>
    </span>
  );
}
