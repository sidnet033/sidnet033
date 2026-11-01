"use client";

import { Icon } from "@/components/icon";

// ⓘ next to an item search box: how multi-phrase search works.
export function ItemSearchHelp({
  className = "right-2",
}: {
  className?: string;
}) {
  return (
    <span className={`group absolute inline-flex ${className}`}>
      <button
        type="button"
        tabIndex={0}
        aria-label="How search works"
        className="text-secondary hover:text-primary focus:text-primary focus:outline-none"
      >
        <Icon name="info" size={15} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden w-80 rounded-md bg-inverse-surface px-3 py-2 text-left text-[12px] font-normal leading-snug text-inverse-on-surface shadow-md group-hover:block group-focus-within:block"
      >
        <b>How search works</b>
        <br />
        Type a word or part of one — it&apos;s matched against SKU, vendor cat
        #, make, category and description.
        <br />
        <br />
        Separate several phrases with <b>|</b> to find items matching <i>any</i>{" "}
        of them, e.g. <span className="font-mono">actuator|teknic|3co|acb</span>
        . Items matching the most phrases are listed first.
      </span>
    </span>
  );
}
