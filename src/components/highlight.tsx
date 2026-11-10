import { Fragment } from "react";

// Wraps every case-insensitive occurrence of any term in a yellow <mark>,
// so a search result shows why it matched.
export function Highlight({
  text,
  terms,
}: {
  text: string | null | undefined;
  terms: string[];
}) {
  if (!text) return <>{text}</>;
  const ts = [...new Set(terms.map((t) => t.toLowerCase()).filter(Boolean))];
  if (ts.length === 0) return <>{text}</>;
  const re = new RegExp(
    `(${ts
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
    "gi",
  );
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-px text-inherit">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** does the text contain any of the terms */
export function hasTerm(text: string | null | undefined, terms: string[]) {
  if (!text || terms.length === 0) return false;
  const t = text.toLowerCase();
  return terms.some((x) => t.includes(x));
}
