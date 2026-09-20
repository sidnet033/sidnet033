"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CostBreakdownCard } from "@/components/cost-breakdown-card";
import { AdHocFeederPanel } from "@/components/ad-hoc-feeder-panel";
import { findDuplicateLibraryFeeder } from "@/lib/feeder-duplicate";
import { ensureUnassignedVertical } from "@/lib/switchboard-bom";
import { itemCode } from "@/lib/item-display";
import { Icon } from "@/components/icon";
import type {
  Feeder,
  FeederItemWithDetails,
  ItemMaster,
  Switchboard,
  SwitchboardBusbarLine,
  SwitchboardEnclosureLine,
} from "@/types/database";

type FeederPlacement = { id: string; vertical_id: string; tier_number: number; qty: number };
type FeederModule = {
  feeder: Feeder;
  placements: FeederPlacement[];
  placementQty: number;
  lines: FeederItemWithDetails[];
};
type LibraryFeederOption = { id: string; name: string; category: string | null; tag: string | null; rating_summary: string | null };

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function lineTotal(lines: FeederItemWithDetails[]) {
  return lines.reduce((s, l) => s + l.qty * l.item.unit_cost, 0);
}

async function loadBomData(supabase: ReturnType<typeof createClient>, switchboardId: string) {
  const { data: switchboard } = await supabase.from("switchboards").select("*").eq("id", switchboardId).single();
  if (!switchboard) return null;

  const { data: verticals } = await supabase.from("verticals").select("id").eq("switchboard_id", switchboardId);
  const verticalIds = ((verticals ?? []) as { id: string }[]).map((v) => v.id);

  const [{ data: placed }, { data: busbarRows }, { data: enclosureRows }, { data: libraryFeeders }] = await Promise.all([
    verticalIds.length
      ? supabase
          .from("placed_feeders")
          .select("id, vertical_id, tier_number, qty, feeder:feeders(*)")
          .in("vertical_id", verticalIds)
      : Promise.resolve({ data: [] }),
    supabase.from("switchboard_busbars").select("*").eq("switchboard_id", switchboardId).order("sort_order"),
    supabase.from("switchboard_enclosure_lines").select("*").eq("switchboard_id", switchboardId).order("sort_order"),
    supabase.from("feeders").select("id, name, category, tag, rating_summary").eq("is_library", true).order("name"),
  ]);

  type PlacedRow = FeederPlacement & { feeder: Feeder };
  const placedRows = (placed ?? []) as unknown as PlacedRow[];

  const feederById = new Map<string, Feeder>();
  const placementsByFeeder = new Map<string, FeederPlacement[]>();
  for (const p of placedRows) {
    feederById.set(p.feeder.id, p.feeder);
    const list = placementsByFeeder.get(p.feeder.id) ?? [];
    list.push({ id: p.id, vertical_id: p.vertical_id, tier_number: p.tier_number, qty: p.qty });
    placementsByFeeder.set(p.feeder.id, list);
  }

  const feederIds = Array.from(feederById.keys());
  const { data: feederLines } = feederIds.length
    ? await supabase.from("feeder_items").select("*, item:item_master(*)").in("feeder_id", feederIds).order("created_at")
    : { data: [] };

  const linesByFeeder = new Map<string, FeederItemWithDetails[]>();
  for (const line of (feederLines ?? []) as unknown as FeederItemWithDetails[]) {
    const list = linesByFeeder.get(line.feeder_id) ?? [];
    list.push(line);
    linesByFeeder.set(line.feeder_id, list);
  }

  const modules: FeederModule[] = feederIds.map((fid) => {
    const placements = placementsByFeeder.get(fid) ?? [];
    return {
      feeder: feederById.get(fid)!,
      placements,
      placementQty: placements.reduce((s, p) => s + p.qty, 0),
      lines: linesByFeeder.get(fid) ?? [],
    };
  });

  const placedFeederIds = new Set(feederIds);
  const libraryFeederOptions = ((libraryFeeders ?? []) as LibraryFeederOption[]).filter((f) => !placedFeederIds.has(f.id));

  return {
    switchboard: switchboard as Switchboard,
    modules,
    busbars: (busbarRows ?? []) as SwitchboardBusbarLine[],
    enclosureLines: (enclosureRows ?? []) as SwitchboardEnclosureLine[],
    libraryFeederOptions,
  };
}

export function BomBuilder({
  switchboardId,
  currentUserId,
  isAdmin,
  revisionArchived,
  allItems,
}: {
  switchboardId: string;
  currentUserId: string;
  isAdmin: boolean;
  revisionArchived: boolean;
  allItems: ItemMaster[];
}) {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [sb, setSb] = useState<Switchboard | null>(null);
  const [modules, setModules] = useState<FeederModule[]>([]);
  const [busbars, setBusbars] = useState<SwitchboardBusbarLine[]>([]);
  const [enclosureLines, setEnclosureLines] = useState<SwitchboardEnclosureLine[]>([]);
  const [libraryOptions, setLibraryOptions] = useState<LibraryFeederOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadBomData(supabase, switchboardId);
      if (cancelled || !data) return;
      setSb(data.switchboard);
      setModules(data.modules);
      setBusbars(data.busbars);
      setEnclosureLines(data.enclosureLines);
      setLibraryOptions(data.libraryFeederOptions);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, switchboardId]);

  const readOnly = !sb || revisionArchived || (sb.locked_by !== null && sb.locked_by !== currentUserId);

  const electrical = modules.reduce((s, m) => s + m.placementQty * lineTotal(m.lines), 0);
  const busbarsTotal = busbars.reduce((s, b) => s + b.qty * b.rate, 0);
  const enclosureTotal = enclosureLines.reduce((s, e) => s + e.qty * e.rate, 0);
  const rmTotal = electrical + busbarsTotal + enclosureTotal;
  const wiringAmt = sb ? (rmTotal * sb.labor_wiring_pct) / 100 : 0;
  const assemblyAmt = sb ? (rmTotal * sb.labor_assembly_pct) / 100 : 0;
  const testingAmt = sb ? (rmTotal * sb.labor_testing_pct) / 100 : 0;
  const laborTotal = wiringAmt + assemblyAmt + testingAmt;
  const mfgTotal = rmTotal + laborTotal;
  const breakdown = {
    electrical,
    busbars: busbarsTotal,
    enclosure: enclosureTotal,
    rmTotal,
    wiringAmt,
    assemblyAmt,
    testingAmt,
    laborTotal,
    mfgTotal,
  };

  async function addLibraryFeeder(opt: LibraryFeederOption) {
    if (!sb) return;
    const vId = await ensureUnassignedVertical(supabase, sb.id);
    const { data: placement, error } = await supabase
      .from("placed_feeders")
      .insert({ vertical_id: vId, feeder_id: opt.id, qty: 1, tier_number: 1, sort_order: 0 })
      .select("*")
      .single();
    if (error) return alert(error.message);
    const { data: feeder } = await supabase.from("feeders").select("*").eq("id", opt.id).single();
    const { data: lines } = await supabase
      .from("feeder_items")
      .select("*, item:item_master(*)")
      .eq("feeder_id", opt.id);
    setModules([
      ...modules,
      {
        feeder: feeder as Feeder,
        placements: [{ id: placement.id, vertical_id: vId, tier_number: 1, qty: 1 }],
        placementQty: 1,
        lines: (lines ?? []) as FeederItemWithDetails[],
      },
    ]);
    setLibraryOptions(libraryOptions.filter((f) => f.id !== opt.id));
  }

  async function handleAdHocCreated(feeder: Feeder & { cost: number }) {
    if (!sb) return;
    const vId = await ensureUnassignedVertical(supabase, sb.id);
    const { data: placement, error } = await supabase
      .from("placed_feeders")
      .insert({ vertical_id: vId, feeder_id: feeder.id, qty: 1, tier_number: 1, sort_order: 0 })
      .select("*")
      .single();
    if (error) return alert(error.message);
    const { data: lines } = await supabase
      .from("feeder_items")
      .select("*, item:item_master(*)")
      .eq("feeder_id", feeder.id);
    setModules([
      ...modules,
      {
        feeder,
        placements: [{ id: placement.id, vertical_id: vId, tier_number: 1, qty: 1 }],
        placementQty: 1,
        lines: (lines ?? []) as FeederItemWithDetails[],
      },
    ]);
  }

  async function duplicateModule(mod: FeederModule) {
    if (!sb) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: newFeeder, error } = await supabase
      .from("feeders")
      .insert({
        name: `${mod.feeder.name} (Copy)`,
        description: mod.feeder.description,
        category: mod.feeder.category,
        tag: mod.feeder.tag,
        rating_summary: mod.feeder.rating_summary,
        switchboard_id: sb.id,
        is_library: false,
        created_by: user?.id,
      })
      .select("*")
      .single();
    if (error || !newFeeder) {
      alert(error?.message ?? "Could not duplicate feeder.");
      return;
    }
    if (mod.lines.length) {
      const { error: linesError } = await supabase
        .from("feeder_items")
        .insert(mod.lines.map((l) => ({ feeder_id: newFeeder.id, item_id: l.item_id, qty: l.qty })));
      if (linesError) {
        alert(linesError.message);
        return;
      }
    }
    const vId = await ensureUnassignedVertical(supabase, sb.id);
    const { data: placement, error: placeError } = await supabase
      .from("placed_feeders")
      .insert({ vertical_id: vId, feeder_id: newFeeder.id, qty: 1, tier_number: 1, sort_order: 0 })
      .select("*")
      .single();
    if (placeError) {
      alert(placeError.message);
      return;
    }
    setModules([
      ...modules,
      {
        feeder: newFeeder as Feeder,
        placements: [{ id: placement.id, vertical_id: vId, tier_number: 1, qty: 1 }],
        placementQty: 1,
        lines: mod.lines.map((l) => ({ ...l, feeder_id: newFeeder.id })),
      },
    ]);
  }

  async function deleteModule(mod: FeederModule) {
    if (!sb) return;
    if (!confirm(`Remove "${mod.feeder.name}" from this switchboard's BOM?`)) return;
    await supabase.from("placed_feeders").delete().in("id", mod.placements.map((p) => p.id));
    if (mod.feeder.switchboard_id === sb.id && !mod.feeder.is_library) {
      await supabase.from("feeders").delete().eq("id", mod.feeder.id);
    }
    setModules(modules.filter((m) => m.feeder.id !== mod.feeder.id));
  }

  async function promoteToLibrary(mod: FeederModule) {
    const itemIds = mod.lines.map((l) => l.item_id);
    const duplicate = await findDuplicateLibraryFeeder(supabase, itemIds, mod.feeder.id);
    if (duplicate) {
      alert(`A feeder with the same items already exists in the Feeder Library: "${duplicate.name}". Not creating a duplicate.`);
      return;
    }
    const { error } = await supabase.from("feeders").update({ is_library: true }).eq("id", mod.feeder.id);
    if (error) {
      alert(error.message);
      return;
    }
    setModules(modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, feeder: { ...m.feeder, is_library: true } } : m)));
  }

  async function updateModuleQty(mod: FeederModule, qty: number) {
    const first = mod.placements[0];
    if (!first) return;
    setModules(
      modules.map((m) =>
        m.feeder.id === mod.feeder.id
          ? { ...m, placementQty: qty, placements: [{ ...first, qty }, ...m.placements.slice(1)] }
          : m
      )
    );
    await supabase.from("placed_feeders").update({ qty }).eq("id", first.id);
  }

  async function addLine(mod: FeederModule, item: ItemMaster, qty: number) {
    const { data, error } = await supabase
      .from("feeder_items")
      .insert({ feeder_id: mod.feeder.id, item_id: item.id, qty })
      .select("*")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setModules(
      modules.map((m) =>
        m.feeder.id === mod.feeder.id ? { ...m, lines: [...m.lines, { ...(data as FeederItemWithDetails), item }] } : m
      )
    );
  }

  async function updateLineQty(mod: FeederModule, lineId: string, qty: number) {
    setModules(
      modules.map((m) =>
        m.feeder.id === mod.feeder.id ? { ...m, lines: m.lines.map((l) => (l.id === lineId ? { ...l, qty } : l)) } : m
      )
    );
    await supabase.from("feeder_items").update({ qty }).eq("id", lineId);
  }

  async function removeLine(mod: FeederModule, lineId: string) {
    setModules(
      modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, lines: m.lines.filter((l) => l.id !== lineId) } : m))
    );
    await supabase.from("feeder_items").delete().eq("id", lineId);
  }

  async function renameFeeder(mod: FeederModule, field: "name" | "tag" | "rating_summary", value: string) {
    setModules(modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, feeder: { ...m.feeder, [field]: value } } : m)));
    await supabase.from("feeders").update({ [field]: value || null, updated_at: new Date().toISOString() }).eq("id", mod.feeder.id);
  }

  async function updateLaborPct(field: "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct", value: number) {
    if (!sb) return;
    const updated = { ...sb, [field]: value };
    setSb(updated);
    await supabase.from("switchboards").update({ [field]: value }).eq("id", sb.id);
  }

  async function addBusbar() {
    if (!sb) return;
    const { data, error } = await supabase
      .from("switchboard_busbars")
      .insert({ switchboard_id: sb.id, description: "New busbar run", qty: 1, rate: 0, sort_order: busbars.length })
      .select("*")
      .single();
    if (error) return alert(error.message);
    setBusbars([...busbars, data as SwitchboardBusbarLine]);
  }
  async function updateBusbar(id: string, patch: Partial<SwitchboardBusbarLine>) {
    setBusbars(busbars.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    await supabase.from("switchboard_busbars").update(patch).eq("id", id);
  }
  async function removeBusbar(id: string) {
    setBusbars(busbars.filter((b) => b.id !== id));
    await supabase.from("switchboard_busbars").delete().eq("id", id);
  }

  async function addEnclosureLine() {
    if (!sb) return;
    const { data, error } = await supabase
      .from("switchboard_enclosure_lines")
      .insert({ switchboard_id: sb.id, description: "New enclosure line", qty: 1, rate: 0, sort_order: enclosureLines.length })
      .select("*")
      .single();
    if (error) return alert(error.message);
    setEnclosureLines([...enclosureLines, data as SwitchboardEnclosureLine]);
  }
  async function updateEnclosureLine(id: string, patch: Partial<SwitchboardEnclosureLine>) {
    setEnclosureLines(enclosureLines.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    await supabase.from("switchboard_enclosure_lines").update(patch).eq("id", id);
  }
  async function removeEnclosureLine(id: string) {
    setEnclosureLines(enclosureLines.filter((e) => e.id !== id));
    await supabase.from("switchboard_enclosure_lines").delete().eq("id", id);
  }

  if (loading || !sb) {
    return <div className="p-8 text-sm text-on-surface-variant">Loading...</div>;
  }

  const badges = [
    sb.std,
    sb.form_of_separation,
    sb.amps ? `${sb.amps}A` : null,
    sb.ka ? `${sb.ka}kA` : null,
    sb.ip_rating ? `IP${sb.ip_rating}` : null,
  ].filter((v): v is string => !!v);

  return (
    <div className="space-y-space-lg p-margin-lg">
      <div className="flex flex-wrap items-start justify-between gap-space-md">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">
            BOM Builder — {sb.tag}
            {sb.title ? `: ${sb.title}` : ""}
          </h1>
          {badges.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {badges.map((b) => (
                <span key={b} className="rounded bg-surface-container-low px-1.5 py-0.5 font-label-md text-label-md text-on-surface-variant">
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          disabled
          title="Export coming soon"
          className="flex items-center gap-1 rounded bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
        >
          <Icon name="file_save" size={16} /> Export BOM (PDF/XLSX)
        </button>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <Icon name="visibility" size={15} />
          {revisionArchived ? "This revision is archived — read only." : "This switchboard is locked by another user — read only until it's released."}
        </div>
      )}

      <CostBreakdownCard breakdown={breakdown} switchboard={sb} readOnly={readOnly} onLaborChange={updateLaborPct} />

      {!readOnly && (
        <div className="flex flex-wrap items-start gap-3">
          <AddFromLibrary options={libraryOptions} onSelect={addLibraryFeeder} />
          <div className="flex-1">
            <AdHocFeederPanel switchboardId={sb.id} allItems={allItems} onCreated={handleAdHocCreated} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {modules.map((mod) => (
          <FeederModuleCard
            key={mod.feeder.id}
            mod={mod}
            readOnly={readOnly}
            canEditLines={!readOnly && (isAdmin || !mod.feeder.is_library)}
            allItems={allItems}
            onRename={(field, value) => renameFeeder(mod, field, value)}
            onQtyChange={(qty) => updateModuleQty(mod, qty)}
            onAddLine={(item, qty) => addLine(mod, item, qty)}
            onLineQtyChange={(lineId, qty) => updateLineQty(mod, lineId, qty)}
            onRemoveLine={(lineId) => removeLine(mod, lineId)}
            onDuplicate={!readOnly ? () => duplicateModule(mod) : undefined}
            onDelete={!readOnly ? () => deleteModule(mod) : undefined}
            onPromote={!readOnly && !mod.feeder.is_library ? () => promoteToLibrary(mod) : undefined}
          />
        ))}
        {modules.length === 0 && (
          <p className="rounded-xl border border-dashed border-surface-container-high py-10 text-center text-sm text-on-surface-variant">
            No feeders in this switchboard&apos;s BOM yet. Add one from the library or build a custom feeder above.
          </p>
        )}
      </div>

      <LineItemsSection
        title="1. Busbars"
        lines={busbars}
        readOnly={readOnly}
        onAdd={addBusbar}
        onUpdate={updateBusbar}
        onRemove={removeBusbar}
      />
      <LineItemsSection
        title="2. Enclosure & Cubicle Construction"
        lines={enclosureLines}
        readOnly={readOnly}
        onAdd={addEnclosureLine}
        onUpdate={updateEnclosureLine}
        onRemove={removeEnclosureLine}
      />
    </div>
  );
}

function AddFromLibrary({
  options,
  onSelect,
}: {
  options: LibraryFeederOption[];
  onSelect: (opt: LibraryFeederOption) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const matches = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : options.slice(0, 8);

  return (
    <div className="relative w-72">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-md border border-surface-container-high bg-surface-container-lowest px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-low"
      >
        <span className="flex items-center gap-1.5">
          <Icon name="library_add" size={16} /> Add Feeder from Library
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} size={16} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-surface-container-high bg-surface-container-lowest shadow-md">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search library feeders..."
            className="w-full border-b border-surface-container px-3 py-2 text-sm focus:outline-none"
          />
          <div className="max-h-64 overflow-y-auto">
            {matches.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  onSelect(f);
                  setOpen(false);
                  setSearch("");
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-container-low"
              >
                <p className="font-medium text-on-surface">{f.name}</p>
                <p className="text-xs text-on-surface-variant">{f.rating_summary || f.category || "—"}</p>
              </button>
            ))}
            {matches.length === 0 && <p className="px-3 py-3 text-sm text-on-surface-variant">No matching feeders.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function FeederModuleCard({
  mod,
  readOnly,
  canEditLines,
  allItems,
  onRename,
  onQtyChange,
  onAddLine,
  onLineQtyChange,
  onRemoveLine,
  onDuplicate,
  onDelete,
  onPromote,
}: {
  mod: FeederModule;
  readOnly: boolean;
  canEditLines: boolean;
  allItems: ItemMaster[];
  onRename: (field: "name" | "tag" | "rating_summary", value: string) => void;
  onQtyChange: (qty: number) => void;
  onAddLine: (item: ItemMaster, qty: number) => void;
  onLineQtyChange: (lineId: string, qty: number) => void;
  onRemoveLine: (lineId: string) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onPromote?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [name, setName] = useState(mod.feeder.name);
  const [tag, setTag] = useState(mod.feeder.tag ?? "");
  const [rating, setRating] = useState(mod.feeder.rating_summary ?? "");
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [addQty, setAddQty] = useState("1");

  const subtotal = mod.placementQty * lineTotal(mod.lines);

  const matches = itemSearch
    ? allItems
        .filter(
          (i) =>
            itemCode(i).toLowerCase().includes(itemSearch.toLowerCase()) ||
            i.description.toLowerCase().includes(itemSearch.toLowerCase())
        )
        .slice(0, 8)
    : [];

  return (
    <div className="overflow-hidden rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-container bg-surface-container-low/60 px-4 py-2.5">
        <button onClick={() => setExpanded(!expanded)} className="text-on-surface-variant hover:text-on-surface-variant">
          <Icon name={expanded ? "expand_less" : "expand_more"} size={18} />
        </button>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            disabled={readOnly || !canEditLines}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onRename("name", name)}
            className="min-w-40 rounded border-none bg-transparent px-1 py-0.5 text-sm font-semibold text-on-surface focus:bg-surface-container-lowest disabled:text-on-surface"
          />
          <input
            disabled={readOnly || !canEditLines}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onBlur={() => onRename("tag", tag)}
            placeholder="TAG"
            className="w-32 rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-0.5 font-mono text-[11px] text-secondary disabled:border-transparent disabled:bg-transparent"
          />
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
              mod.feeder.is_library
                ? "border-blue-200/60 bg-blue-50 text-blue-700"
                : "border-surface-container-high bg-surface-container-low text-secondary"
            }`}
          >
            {mod.feeder.is_library ? "Library Feeder" : "Custom Feeder"}
          </span>
          <input
            disabled={readOnly || !canEditLines}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            onBlur={() => onRename("rating_summary", rating)}
            placeholder="Rating summary"
            className="w-48 rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-0.5 text-[11px] text-secondary disabled:border-transparent disabled:bg-transparent"
          />
        </div>
        <div className="flex items-center gap-1 text-xs text-secondary">
          <span>Qty</span>
          <input
            type="number"
            min="1"
            disabled={readOnly}
            value={mod.placementQty}
            onChange={(e) => onQtyChange(Number(e.target.value) || 1)}
            className="w-14 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:bg-surface-container-low"
          />
        </div>
        <span className="font-display text-sm font-semibold text-on-surface">{money(subtotal)}</span>
        {!readOnly && (
          <div className="flex items-center gap-2 text-xs">
            {onPromote && (
              <button onClick={onPromote} className="flex items-center gap-1 text-primary hover:underline">
                <Icon name="upload" size={13} /> Save In Library
              </button>
            )}
            {onDuplicate && (
              <button onClick={onDuplicate} title="Duplicate feeder structure" className="text-secondary hover:text-on-surface">
                <Icon name="content_copy" size={15} />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} className="text-error hover:text-error/70">
                <Icon name="delete" size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-3">
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-on-surface-variant">
              <tr>
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 py-1">Vendor Cat</th>
                <th className="px-2 py-1">Description</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">List Price</th>
                <th className="px-2 py-1 text-right">Disc %</th>
                <th className="px-2 py-1 text-right">Net Rate</th>
                <th className="px-2 py-1">UOM</th>
                <th className="px-2 py-1 text-right">Amount</th>
                {canEditLines && <th className="px-2 py-1" />}
              </tr>
            </thead>
            <tbody>
              {mod.lines.map((line) => (
                <tr key={line.id} className="border-t border-surface-container">
                  <td className="px-2 py-1.5 font-mono">{line.item.sku || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-secondary">{line.item.vendor_cat || "—"}</td>
                  <td className="px-2 py-1.5">{line.item.description}</td>
                  <td className="px-2 py-1.5 text-right">
                    {canEditLines ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.qty}
                        onChange={(e) => onLineQtyChange(line.id, Number(e.target.value) || 0)}
                        className="w-16 rounded border border-surface-container-high px-1 py-0.5 text-right"
                      />
                    ) : (
                      line.qty
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-on-surface-variant">
                    {line.item.list_price != null ? money(line.item.list_price) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-on-surface-variant">
                    {line.item.discount_pct != null ? `${line.item.discount_pct}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-secondary">{money(line.item.unit_cost)}</td>
                  <td className="px-2 py-1.5 text-secondary">{line.item.uom}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(line.qty * line.item.unit_cost)}</td>
                  {canEditLines && (
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => onRemoveLine(line.id)} className="text-error hover:underline">
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {mod.lines.length === 0 && (
                <tr>
                  <td colSpan={canEditLines ? 10 : 9} className="px-2 py-4 text-center text-on-surface-variant">
                    No items in this feeder yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {canEditLines && (
            <div className="relative mt-2 flex items-end gap-2">
              <div className="relative w-64">
                <input
                  value={itemSearch}
                  onChange={(e) => {
                    setItemSearch(e.target.value);
                    setSelectedItemId("");
                  }}
                  placeholder="+ Add item SKU or search..."
                  className="w-full rounded border border-surface-container-high px-2 py-1 text-xs"
                />
                {matches.length > 0 && !selectedItemId && (
                  <div className="absolute z-10 mt-1 w-64 rounded-md border border-surface-container-high bg-surface-container-lowest shadow-sm">
                    {matches.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => {
                          setSelectedItemId(m.id);
                          setItemSearch(`${itemCode(m)} — ${m.description}`);
                        }}
                        className="block w-full px-2 py-1 text-left text-xs hover:bg-surface-container-low"
                      >
                        <span className="font-mono text-secondary">{itemCode(m)}</span> {m.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                className="w-16 rounded border border-surface-container-high px-1.5 py-1 text-xs"
              />
              <button
                onClick={() => {
                  const item = allItems.find((i) => i.id === selectedItemId);
                  if (!item) return;
                  onAddLine(item, Number(addQty) || 1);
                  setSelectedItemId("");
                  setItemSearch("");
                  setAddQty("1");
                }}
                disabled={!selectedItemId}
                className="rounded bg-secondary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-3 border-t border-surface-container pt-2 text-xs text-secondary">
            <span>{mod.lines.length} items</span>
            <span className="font-semibold text-on-surface">Feeder Total: {money(subtotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LineItemsSection<T extends { id: string; description: string; qty: number; rate: number }>({
  title,
  lines,
  readOnly,
  onAdd,
  onUpdate,
  onRemove,
}: {
  title: string;
  lines: T[];
  readOnly: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<T>) => void;
  onRemove: (id: string) => void;
}) {
  const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  return (
    <div className="overflow-hidden rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs">
      <div className="flex items-center justify-between border-b border-surface-container bg-surface-container-low/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        {!readOnly && (
          <button onClick={onAdd} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Icon name="add" size={14} /> Add line
          </button>
        )}
      </div>
      <table className="w-full text-xs">
        <thead className="text-left uppercase tracking-wide text-on-surface-variant">
          <tr>
            <th className="px-3 py-1.5">Description</th>
            <th className="px-3 py-1.5 text-right">Qty</th>
            <th className="px-3 py-1.5 text-right">Rate</th>
            <th className="px-3 py-1.5 text-right">Amount</th>
            {!readOnly && <th className="px-3 py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-surface-container">
              <td className="px-3 py-1.5">
                <input
                  disabled={readOnly}
                  value={l.description}
                  onChange={(e) => onUpdate(l.id, { description: e.target.value } as Partial<T>)}
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 focus:border-surface-container-high disabled:bg-transparent"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <input
                  type="number"
                  disabled={readOnly}
                  value={l.qty}
                  onChange={(e) => onUpdate(l.id, { qty: Number(e.target.value) || 0 } as Partial<T>)}
                  className="w-16 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <input
                  type="number"
                  disabled={readOnly}
                  value={l.rate}
                  onChange={(e) => onUpdate(l.id, { rate: Number(e.target.value) || 0 } as Partial<T>)}
                  className="w-24 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                />
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(l.qty * l.rate)}</td>
              {!readOnly && (
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => onRemove(l.id)} className="text-error hover:underline">
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-on-surface-variant">
                No lines yet.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-surface-container-high bg-surface-container-low font-medium">
            <td colSpan={3} className="px-3 py-1.5 text-right">
              Total
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums">{money(total)}</td>
            {!readOnly && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
