"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Feeder, FeederItemWithDetails, ItemMaster } from "@/types/database";

export function FeederBuilder({
  feeder,
  initialLines,
  allItems,
  isAdmin,
}: {
  feeder: Feeder;
  initialLines: FeederItemWithDetails[];
  allItems: ItemMaster[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [name, setName] = useState(feeder.name);
  const [category, setCategory] = useState(feeder.category ?? "");
  const [description, setDescription] = useState(feeder.description ?? "");
  const [lines, setLines] = useState(initialLines);

  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [qty, setQty] = useState("1");

  const total = lines.reduce((sum, l) => sum + l.qty * l.item.unit_cost, 0);

  const matches = itemSearch
    ? allItems
        .filter(
          (i) =>
            i.item_code.toLowerCase().includes(itemSearch.toLowerCase()) ||
            i.description.toLowerCase().includes(itemSearch.toLowerCase())
        )
        .slice(0, 8)
    : [];

  async function saveDetails() {
    const { error } = await supabase
      .from("feeders")
      .update({ name, category: category || null, description: description || null, updated_at: new Date().toISOString() })
      .eq("id", feeder.id);
    if (error) alert(error.message);
  }

  async function addLine() {
    if (!selectedItemId) return;
    const item = allItems.find((i) => i.id === selectedItemId);
    if (!item) return;

    const { data, error } = await supabase
      .from("feeder_items")
      .insert({ feeder_id: feeder.id, item_id: item.id, qty: Number(qty) || 1 })
      .select("*")
      .single();

    if (error) {
      alert(error.message);
      return;
    }
    setLines([...lines, { ...(data as FeederItemWithDetails), item }]);
    setSelectedItemId("");
    setItemSearch("");
    setQty("1");
  }

  async function updateQty(lineId: string, newQty: number) {
    setLines(lines.map((l) => (l.id === lineId ? { ...l, qty: newQty } : l)));
    await supabase.from("feeder_items").update({ qty: newQty }).eq("id", lineId);
  }

  async function removeLine(lineId: string) {
    setLines(lines.filter((l) => l.id !== lineId));
    await supabase.from("feeder_items").delete().eq("id", lineId);
  }

  async function deleteFeeder() {
    if (!confirm(`Delete feeder "${feeder.name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("feeders").delete().eq("id", feeder.id);
    if (error) {
      alert(error.message);
      return;
    }
    router.push("/feeders");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Feeder name</label>
              <input
                disabled={!isAdmin}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveDetails}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Category</label>
              <input
                disabled={!isAdmin}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={saveDetails}
                placeholder="e.g. Incomer, Outgoing, APFC"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
              <input
                disabled={!isAdmin}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={saveDetails}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </div>
          </div>
        </div>
        {isAdmin && (
          <button onClick={deleteFeeder} className="whitespace-nowrap text-sm text-rose-600 hover:underline">
            Delete feeder
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="relative flex flex-wrap items-end gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="w-72">
            <label className="mb-1 block text-xs font-medium text-slate-600">Add item from master</label>
            <input
              value={itemSearch}
              onChange={(e) => {
                setItemSearch(e.target.value);
                setSelectedItemId("");
              }}
              placeholder="Search code or description..."
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            {matches.length > 0 && !selectedItemId && (
              <div className="absolute z-10 mt-1 w-72 rounded-md border border-slate-200 bg-white shadow-sm">
                {matches.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => {
                      setSelectedItemId(m.id);
                      setItemSearch(`${m.item_code} — ${m.description}`);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-mono text-xs text-slate-500">{m.item_code}</span> {m.description}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Qty</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={addLine}
            disabled={!selectedItemId}
            className="rounded-md bg-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
          >
            Add line
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">Line cost</th>
              {isAdmin && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{line.item.item_code}</td>
                <td className="px-3 py-2">{line.item.description}</td>
                <td className="px-3 py-2 text-right">
                  {isAdmin ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.qty}
                      onChange={(e) => updateQty(line.id, Number(e.target.value) || 0)}
                      className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right"
                    />
                  ) : (
                    line.qty
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  ₹{line.item.unit_cost.toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ₹{(line.qty * line.item.unit_cost).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
                {isAdmin && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => removeLine(line.id)} className="text-xs text-rose-600 hover:underline">
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-3 py-8 text-center text-slate-400">
                  No items added to this feeder yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-medium">
              <td colSpan={isAdmin ? 4 : 3} className="px-3 py-2 text-right">
                Feeder total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </td>
              {isAdmin && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
