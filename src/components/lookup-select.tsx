"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

type Option = { id: string; name: string };

// Select-or-add combobox backed by a simple {id, name} lookup table
// (consultants / sales_execs / switchboard_types) that any signed-in
// user can add new options to.
export function LookupSelect({
  table,
  value,
  onChange,
  disabled,
  placeholder = "Select or add...",
  options: sharedOptions,
  onOptionsChange,
}: {
  table: "consultants" | "sales_execs" | "switchboard_types";
  value: string | null;
  onChange: (id: string | null, name: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  // When provided, this list is used instead of each instance fetching its
  // own copy (avoids one request per table row). onOptionsChange is called
  // when a new option is added so the caller can keep its shared list in sync.
  options?: Option[];
  onOptionsChange?: (options: Option[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [ownOptions, setOwnOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const options = sharedOptions ?? ownOptions;
  const setOptions = onOptionsChange ?? setOwnOptions;

  useEffect(() => {
    if (sharedOptions) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from(table).select("id, name").order("name");
      if (!cancelled) setOwnOptions((data ?? []) as Option[]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, table, !!sharedOptions]);

  const selected = options.find((o) => o.id === value) ?? null;
  const matches = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;
  const exactMatch = options.some((o) => o.name.toLowerCase() === search.trim().toLowerCase());

  async function addNew() {
    const name = search.trim();
    if (!name) return;
    setAdding(true);
    const { data, error } = await supabase.from(table).insert({ name }).select("id, name").single();
    setAdding(false);
    if (error) {
      alert(error.message);
      return;
    }
    setOptions([...options, data as Option].sort((a, b) => a.name.localeCompare(b.name)));
    onChange(data.id, data.name);
    setOpen(false);
    setSearch("");
  }

  if (disabled) {
    return <span className="text-sm text-slate-700">{selected?.name ?? "—"}</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
      >
        <span className={selected ? "" : "text-slate-400"}>{selected?.name ?? placeholder}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={15} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white shadow-md">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or type new name..."
            className="w-full border-b border-slate-100 px-2.5 py-1.5 text-sm focus:outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null, null);
                  setOpen(false);
                }}
                className="block w-full px-2.5 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50"
              >
                Clear selection
              </button>
            )}
            {matches.map((o) => (
              <button
                type="button"
                key={o.id}
                onClick={() => {
                  onChange(o.id, o.name);
                  setOpen(false);
                  setSearch("");
                }}
                className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                {o.name}
              </button>
            ))}
            {matches.length === 0 && <p className="px-2.5 py-2 text-xs text-slate-400">No matches.</p>}
          </div>
          {search.trim() && !exactMatch && (
            <button
              type="button"
              onClick={addNew}
              disabled={adding}
              className="flex w-full items-center gap-1 border-t border-slate-100 px-2.5 py-1.5 text-left text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50"
            >
              <Icon name="add" size={13} /> Add &quot;{search.trim()}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
