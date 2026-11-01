import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type LogRow = {
  id: string;
  batch_id: string;
  created_at: string;
  user_id: string | null;
  feeder_name: string | null;
  feeder_tag: string | null;
  item_code: string | null;
  item_description: string | null;
  old_list_price: number | null;
  new_list_price: number | null;
  old_discount_pct: number | null;
  new_discount_pct: number | null;
};

const inr = (n: number | null) =>
  n == null
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n == null ? "—" : `${Number(n)}%`);

// Every bulk price update of library feeders made from Feeder Master's
// "Paste prices", newest first, one block per update.
export default async function PriceLogPage() {
  const current = await getCurrentUser();
  if (current?.profile?.role !== "admin") redirect("/");

  const supabase = await createClient();
  const { data } = await supabase
    .from("price_update_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  const rows = (data ?? []) as LogRow[];
  const userIds = [
    ...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v)),
  ];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      (p.full_name as string | null) ?? "—",
    ]),
  );

  const batches: { id: string; at: string; by: string; rows: LogRow[] }[] = [];
  for (const r of rows) {
    let b = batches.find((x) => x.id === r.batch_id);
    if (!b) {
      b = {
        id: r.batch_id,
        at: r.created_at,
        by: r.user_id ? (names.get(r.user_id) ?? "—") : "—",
        rows: [],
      };
      batches.push(b);
    }
    b.rows.push(r);
  }

  return (
    <div className="max-w-6xl space-y-4 px-8 py-6">
      <div>
        <Link
          href="/admin"
          className="text-xs text-secondary hover:text-primary"
        >
          &larr; Admin Space
        </Link>
        <h1 className="text-[18px] font-bold text-on-surface">
          Price Update Log
        </h1>
        <p className="text-sm text-secondary">
          Bulk list price / discount updates made to library feeders from Feeder
          Master → Paste prices. BOMs keep their own copies of library feeders,
          so these never change existing projects.
        </p>
      </div>
      {batches.length === 0 && (
        <p className="rounded-lg border border-dashed border-surface-container-high py-10 text-center text-sm text-secondary">
          No price updates yet.
        </p>
      )}
      {batches.map((b) => (
        <div
          key={b.id}
          className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-container-high px-4 py-2 text-[13px]">
            <span>
              <b>
                {new Date(b.at).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </b>{" "}
              · by {b.by}
            </span>
            <span className="text-secondary">
              {b.rows.length} line{b.rows.length === 1 ? "" : "s"} in{" "}
              {new Set(b.rows.map((r) => r.feeder_name)).size} feeder(s)
            </span>
          </div>
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-secondary">
              <tr>
                <th className="px-3 py-1.5">Feeder</th>
                <th className="px-3 py-1.5">Item</th>
                <th className="px-3 py-1.5 text-right">List price</th>
                <th className="px-3 py-1.5 text-right">Discount</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.id} className="border-t border-surface-container">
                  <td className="px-3 py-1.5">
                    {r.feeder_name ?? "—"}
                    {r.feeder_tag && (
                      <span className="ml-1.5 font-mono text-[11px] text-secondary">
                        {r.feeder_tag}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="font-mono">{r.item_code ?? "—"}</span>
                    <span className="ml-1.5 text-secondary">
                      {r.item_description}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    {inr(r.old_list_price)} → <b>{inr(r.new_list_price)}</b>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    {pct(r.old_discount_pct)} → <b>{pct(r.new_discount_pct)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
