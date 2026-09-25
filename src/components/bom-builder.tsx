"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CostBreakdownCard } from "@/components/cost-breakdown-card";
import { AdHocFeederPanel } from "@/components/ad-hoc-feeder-panel";
import { findDuplicateLibraryFeeder } from "@/lib/feeder-duplicate";
import { ensureUnassignedVertical } from "@/lib/switchboard-bom";
import { effectiveNetRate } from "@/lib/feeder-cost";
import { computeFeederTag } from "@/lib/feeder-tag";
import { itemCode } from "@/lib/item-display";
import { Icon } from "@/components/icon";
import { formatMoney } from "@/lib/money";
import type {
  Feeder,
  FeederItemWithDetails,
  ItemMaster,
  Switchboard,
  SwitchboardBusbarLine,
  SwitchboardEnclosureLine,
} from "@/types/database";

// BOM Builder always works in the base currency (INR) — it's the internal
// costing/build tool, not a customer-facing price. Only switchboard/project
// price rollups (Costing Summary, Project Detail, Dashboard) convert to the
// project's currency.
const money = (n: number) => formatMoney(n);

type LibraryFeederOption = { id: string; name: string; category: string | null; tag: string | null; rating_summary: string | null };

type DraftLine = {
  id: string; // real feeder_items id, or "new-<uuid>" if not yet persisted
  item_id: string;
  item: ItemMaster;
  qty: number;
  list_price_override: number | null;
  discount_pct_override: number | null;
};

type DraftModule = {
  feeder: Feeder;
  baselineFeeder: Feeder;
  placementId: string; // real placed_feeders id, or "new-<uuid>" if not yet placed
  qty: number;
  lines: DraftLine[];
  baselineLines: DraftLine[]; // what's actually in the DB right now, for diffing on Save
};

type DraftBusbar = { id: string; description: string; qty: number; rate: number };
type DraftEnclosure = { id: string; description: string; qty: number; rate: number };

type BomDraft = {
  modules: DraftModule[];
  busbars: DraftBusbar[];
  enclosureLines: DraftEnclosure[];
  laborWiring: number;
  laborAssembly: number;
  laborTesting: number;
};

function newId() {
  return `new-${crypto.randomUUID()}`;
}

function toDraftLine(l: FeederItemWithDetails): DraftLine {
  return {
    id: l.id,
    item_id: l.item_id,
    item: l.item,
    qty: l.qty,
    list_price_override: l.list_price_override,
    discount_pct_override: l.discount_pct_override,
  };
}

function lineTotal(lines: DraftLine[]) {
  return lines.reduce((s, l) => s + l.qty * effectiveNetRate(l.item, l.list_price_override, l.discount_pct_override), 0);
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

  type PlacedRow = { id: string; vertical_id: string; tier_number: number; qty: number; feeder: Feeder };
  const placedRows = (placed ?? []) as unknown as PlacedRow[];

  const feederById = new Map<string, Feeder>();
  const placementIdByFeeder = new Map<string, string>();
  const qtyByFeeder = new Map<string, number>();
  for (const p of placedRows) {
    feederById.set(p.feeder.id, p.feeder);
    placementIdByFeeder.set(p.feeder.id, p.id);
    qtyByFeeder.set(p.feeder.id, p.qty);
  }

  const feederIds = Array.from(feederById.keys());
  const { data: feederLines } = feederIds.length
    ? await supabase.from("feeder_items").select("*, item:item_master(*)").in("feeder_id", feederIds).order("sort_order")
    : { data: [] };

  const linesByFeeder = new Map<string, FeederItemWithDetails[]>();
  for (const line of (feederLines ?? []) as unknown as FeederItemWithDetails[]) {
    const list = linesByFeeder.get(line.feeder_id) ?? [];
    list.push(line);
    linesByFeeder.set(line.feeder_id, list);
  }

  const modules: DraftModule[] = feederIds.map((fid) => {
    const feeder = feederById.get(fid)!;
    const lines = (linesByFeeder.get(fid) ?? []).map(toDraftLine);
    return {
      feeder,
      baselineFeeder: feeder,
      placementId: placementIdByFeeder.get(fid)!,
      qty: qtyByFeeder.get(fid) ?? 1,
      lines,
      baselineLines: lines,
    };
  });

  return {
    switchboard: switchboard as Switchboard,
    modules,
    busbars: (busbarRows ?? []) as SwitchboardBusbarLine[],
    enclosureLines: (enclosureRows ?? []) as SwitchboardEnclosureLine[],
    libraryFeedersAll: (libraryFeeders ?? []) as LibraryFeederOption[],
  };
}

type LoadedBomData = NonNullable<Awaited<ReturnType<typeof loadBomData>>>;

function toDraft(data: LoadedBomData): BomDraft {
  return {
    modules: data.modules,
    busbars: data.busbars.map((b) => ({ id: b.id, description: b.description, qty: b.qty, rate: b.rate })),
    enclosureLines: data.enclosureLines.map((e) => ({ id: e.id, description: e.description, qty: e.qty, rate: e.rate })),
    laborWiring: data.switchboard.labor_wiring_pct,
    laborAssembly: data.switchboard.labor_assembly_pct,
    laborTesting: data.switchboard.labor_testing_pct,
  };
}

async function saveLineTable(
  supabase: ReturnType<typeof createClient>,
  table: "switchboard_busbars" | "switchboard_enclosure_lines",
  switchboardId: string,
  saved: (DraftBusbar | DraftEnclosure)[],
  draft: (DraftBusbar | DraftEnclosure)[]
) {
  const draftIds = new Set(draft.map((r) => r.id));
  for (const r of saved) {
    if (!draftIds.has(r.id)) {
      const { error } = await supabase.from(table).delete().eq("id", r.id);
      if (error) throw error;
    }
  }
  for (const [i, r] of draft.entries()) {
    if (r.id.startsWith("new-")) {
      const { error } = await supabase
        .from(table)
        .insert({ switchboard_id: switchboardId, description: r.description, qty: r.qty, rate: r.rate, sort_order: i });
      if (error) throw error;
    } else {
      const prior = saved.find((x) => x.id === r.id);
      if (!prior || prior.description !== r.description || prior.qty !== r.qty || prior.rate !== r.rate) {
        const { error } = await supabase
          .from(table)
          .update({ description: r.description, qty: r.qty, rate: r.rate, sort_order: i })
          .eq("id", r.id);
        if (error) throw error;
      }
    }
  }
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
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [sb, setSb] = useState<Switchboard | null>(null);
  const [saved, setSaved] = useState<BomDraft | null>(null);
  const [draft, setDraft] = useState<BomDraft | null>(null);
  const [libraryFeedersAll, setLibraryFeedersAll] = useState<LibraryFeederOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadBomData(supabase, switchboardId);
      if (cancelled || !data) return;
      setSb(data.switchboard);
      const d = toDraft(data);
      setSaved(d);
      setDraft(d);
      setLibraryFeedersAll(data.libraryFeedersAll);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, switchboardId]);

  const readOnly = !sb || revisionArchived || (sb.locked_by !== null && sb.locked_by !== currentUserId);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  // Ctrl+S / Cmd+S saves the BOM, same as clicking "Save Changes". handleSave
  // closes over the latest draft/saved on every render, so it's tracked via a
  // ref (updated on every render) rather than a useEffect dependency -- that
  // keeps the listener itself mounted once while always calling the freshest
  // save function instead of one captured from a stale render.
  const keyboardSaveRef = useRef({ readOnly, dirty, saving, handleSave: () => {} });
  useEffect(() => {
    keyboardSaveRef.current = { readOnly, dirty, saving, handleSave };
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const { readOnly, dirty, saving, handleSave } = keyboardSaveRef.current;
        if (!readOnly && dirty && !saving) handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const electrical = draft ? draft.modules.reduce((s, m) => s + m.qty * lineTotal(m.lines), 0) : 0;
  const busbarsTotal = draft ? draft.busbars.reduce((s, b) => s + b.qty * b.rate, 0) : 0;
  const enclosureTotal = draft ? draft.enclosureLines.reduce((s, e) => s + e.qty * e.rate, 0) : 0;
  const rmTotal = electrical + busbarsTotal + enclosureTotal;
  const wiringAmt = draft ? (rmTotal * draft.laborWiring) / 100 : 0;
  const assemblyAmt = draft ? (rmTotal * draft.laborAssembly) / 100 : 0;
  const testingAmt = draft ? (rmTotal * draft.laborTesting) / 100 : 0;
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
    const { data: feeder } = await supabase.from("feeders").select("*").eq("id", opt.id).single();
    const { data: lines } = await supabase.from("feeder_items").select("*, item:item_master(*)").eq("feeder_id", opt.id).order("sort_order");
    if (!feeder) return;
    const draftLines = ((lines ?? []) as unknown as FeederItemWithDetails[]).map(toDraftLine);
    setDraft((d) =>
      d
        ? {
            ...d,
            modules: [
              ...d.modules,
              { feeder: feeder as Feeder, baselineFeeder: feeder as Feeder, placementId: newId(), qty: 1, lines: draftLines, baselineLines: draftLines },
            ],
          }
        : d
    );
  }

  async function handleAdHocCreated(feeder: Feeder & { cost: number }) {
    const { data: lines } = await supabase.from("feeder_items").select("*, item:item_master(*)").eq("feeder_id", feeder.id).order("sort_order");
    const draftLines = ((lines ?? []) as unknown as FeederItemWithDetails[]).map(toDraftLine);
    setDraft((d) =>
      d
        ? {
            ...d,
            modules: [...d.modules, { feeder, baselineFeeder: feeder, placementId: newId(), qty: 1, lines: draftLines, baselineLines: draftLines }],
          }
        : d
    );
  }

  async function duplicateModule(mod: DraftModule) {
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
    let newLines: FeederItemWithDetails[] = [];
    if (mod.lines.length) {
      const { data: inserted, error: linesError } = await supabase
        .from("feeder_items")
        .insert(
          mod.lines.map((l, i) => ({
            feeder_id: newFeeder.id,
            item_id: l.item_id,
            qty: l.qty,
            sort_order: i,
            list_price_override: l.list_price_override,
            discount_pct_override: l.discount_pct_override,
          }))
        )
        .select("*, item:item_master(*)");
      if (linesError) {
        alert(linesError.message);
        return;
      }
      newLines = (inserted ?? []) as unknown as FeederItemWithDetails[];
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
    const draftLines = newLines.map(toDraftLine);
    const newModule: DraftModule = {
      feeder: newFeeder as Feeder,
      baselineFeeder: newFeeder as Feeder,
      placementId: placement.id,
      qty: 1,
      lines: draftLines,
      baselineLines: draftLines,
    };
    setSaved((s) => (s ? { ...s, modules: [...s.modules, newModule] } : s));
    setDraft((d) => (d ? { ...d, modules: [...d.modules, newModule] } : d));
    router.refresh();
  }

  function deleteModule(mod: DraftModule) {
    setDraft((d) => (d ? { ...d, modules: d.modules.filter((m) => m.feeder.id !== mod.feeder.id) } : d));
  }

  async function promoteToLibrary(mod: DraftModule) {
    const itemIds = mod.lines.map((l) => l.item_id);
    const duplicate = await findDuplicateLibraryFeeder(supabase, itemIds, mod.feeder.id);
    if (duplicate) {
      alert(`A feeder with the same items already exists in the Feeder Library: "${duplicate.name}". Not creating a duplicate.`);
      return;
    }
    const patch: Partial<Feeder> = { is_library: true };
    if (!mod.feeder.tag) {
      patch.tag = computeFeederTag(
        mod.feeder.category ?? "",
        mod.feeder.rated_current != null ? String(mod.feeder.rated_current) : "",
        mod.lines[0]?.item.make ?? null,
        libraryFeedersAll,
        mod.feeder.id
      );
    }
    const { error } = await supabase.from("feeders").update(patch).eq("id", mod.feeder.id);
    if (error) {
      alert(error.message);
      return;
    }
    const flip = (m: DraftModule) => (m.feeder.id === mod.feeder.id ? { ...m, feeder: { ...m.feeder, ...patch }, baselineFeeder: { ...m.baselineFeeder, ...patch } } : m);
    setSaved((s) => (s ? { ...s, modules: s.modules.map(flip) } : s));
    setDraft((d) => (d ? { ...d, modules: d.modules.map(flip) } : d));
    setLibraryFeedersAll((prev) => [
      ...prev,
      { id: mod.feeder.id, name: mod.feeder.name, category: mod.feeder.category, tag: patch.tag ?? mod.feeder.tag, rating_summary: mod.feeder.rating_summary },
    ]);
  }

  function updateModuleQty(mod: DraftModule, qty: number) {
    setDraft((d) => (d ? { ...d, modules: d.modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, qty } : m)) } : d));
  }

  function addLine(mod: DraftModule, item: ItemMaster, qty: number) {
    const line: DraftLine = { id: newId(), item_id: item.id, item, qty, list_price_override: null, discount_pct_override: null };
    setDraft((d) => (d ? { ...d, modules: d.modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, lines: [...m.lines, line] } : m)) } : d));
  }

  function updateLineQty(mod: DraftModule, lineId: string, qty: number) {
    setDraft((d) =>
      d
        ? { ...d, modules: d.modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, lines: m.lines.map((l) => (l.id === lineId ? { ...l, qty } : l)) } : m)) }
        : d
    );
  }

  function updateLineOverride(mod: DraftModule, lineId: string, field: "list_price_override" | "discount_pct_override", value: number | null) {
    setDraft((d) =>
      d
        ? {
            ...d,
            modules: d.modules.map((m) =>
              m.feeder.id === mod.feeder.id ? { ...m, lines: m.lines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)) } : m
            ),
          }
        : d
    );
  }

  function removeLine(mod: DraftModule, lineId: string) {
    setDraft((d) =>
      d ? { ...d, modules: d.modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, lines: m.lines.filter((l) => l.id !== lineId) } : m)) } : d
    );
  }

  function renameFeeder(mod: DraftModule, field: "name" | "tag" | "rating_summary", value: string) {
    setDraft((d) =>
      d ? { ...d, modules: d.modules.map((m) => (m.feeder.id === mod.feeder.id ? { ...m, feeder: { ...m.feeder, [field]: value || null } } : m)) } : d
    );
  }

  function updateLaborPct(field: "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct", value: number) {
    const key = field === "labor_wiring_pct" ? "laborWiring" : field === "labor_assembly_pct" ? "laborAssembly" : "laborTesting";
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function applyCategoryDiscount(category: string, discountPct: number) {
    setDraft((d) =>
      d
        ? {
            ...d,
            modules: d.modules.map((m) => ({
              ...m,
              lines: m.lines.map((l) => (l.item.category === category ? { ...l, discount_pct_override: discountPct } : l)),
            })),
          }
        : d
    );
  }

  function addBusbar() {
    setDraft((d) => (d ? { ...d, busbars: [...d.busbars, { id: newId(), description: "New busbar run", qty: 1, rate: 0 }] } : d));
  }
  function updateBusbar(id: string, patch: Partial<DraftBusbar>) {
    setDraft((d) => (d ? { ...d, busbars: d.busbars.map((b) => (b.id === id ? { ...b, ...patch } : b)) } : d));
  }
  function removeBusbar(id: string) {
    setDraft((d) => (d ? { ...d, busbars: d.busbars.filter((b) => b.id !== id) } : d));
  }

  function addEnclosureLine() {
    setDraft((d) => (d ? { ...d, enclosureLines: [...d.enclosureLines, { id: newId(), description: "New enclosure line", qty: 1, rate: 0 }] } : d));
  }
  function updateEnclosureLine(id: string, patch: Partial<DraftEnclosure>) {
    setDraft((d) => (d ? { ...d, enclosureLines: d.enclosureLines.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : d));
  }
  function removeEnclosureLine(id: string) {
    setDraft((d) => (d ? { ...d, enclosureLines: d.enclosureLines.filter((e) => e.id !== id) } : d));
  }

  function handleCancel() {
    if (!saved) return;
    setDraft(structuredClone(saved));
    setResetKey((k) => k + 1);
  }

  async function handleSave() {
    if (!sb || !draft || !saved) return;
    setSaving(true);
    try {
      const laborPatch: Partial<Pick<Switchboard, "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct">> = {};
      if (draft.laborWiring !== saved.laborWiring) laborPatch.labor_wiring_pct = draft.laborWiring;
      if (draft.laborAssembly !== saved.laborAssembly) laborPatch.labor_assembly_pct = draft.laborAssembly;
      if (draft.laborTesting !== saved.laborTesting) laborPatch.labor_testing_pct = draft.laborTesting;
      if (Object.keys(laborPatch).length) {
        const { error } = await supabase.from("switchboards").update(laborPatch).eq("id", sb.id);
        if (error) throw error;
      }

      await saveLineTable(supabase, "switchboard_busbars", sb.id, saved.busbars, draft.busbars);
      await saveLineTable(supabase, "switchboard_enclosure_lines", sb.id, saved.enclosureLines, draft.enclosureLines);

      const savedModuleIds = new Set(saved.modules.map((m) => m.feeder.id));
      const draftModuleIds = new Set(draft.modules.map((m) => m.feeder.id));

      for (const m of saved.modules) {
        if (!draftModuleIds.has(m.feeder.id)) {
          const { error } = await supabase.from("placed_feeders").delete().eq("id", m.placementId);
          if (error) throw error;
          if (m.feeder.switchboard_id === sb.id && !m.feeder.is_library) {
            await supabase.from("feeders").delete().eq("id", m.feeder.id);
          }
        }
      }

      let currentUserId: string | undefined;

      for (const m of draft.modules) {
        const isNewPlacement = !savedModuleIds.has(m.feeder.id);

        // A library feeder is shared master data — editing its fields or
        // lines here must never mutate it. If it was customized in this
        // session, fork it into a new switchboard-scoped custom feeder now
        // (so it shows as "Custom Feeder" from here on) and leave the
        // original library feeder untouched.
        const feederFieldsChanged =
          m.baselineFeeder.name !== m.feeder.name ||
          m.baselineFeeder.tag !== m.feeder.tag ||
          m.baselineFeeder.rating_summary !== m.feeder.rating_summary ||
          m.baselineFeeder.category !== m.feeder.category ||
          m.baselineFeeder.description !== m.feeder.description ||
          m.baselineFeeder.rated_current !== m.feeder.rated_current ||
          m.baselineFeeder.pole_config !== m.feeder.pole_config ||
          m.baselineFeeder.breaking_capacity !== m.feeder.breaking_capacity;
        const draftLineIdSet = new Set(m.lines.map((l) => l.id));
        const linesChanged =
          m.baselineLines.some((l) => !draftLineIdSet.has(l.id)) ||
          m.lines.some((l) => {
            if (l.id.startsWith("new-")) return true;
            const prior = m.baselineLines.find((x) => x.id === l.id);
            return !prior || prior.qty !== l.qty || prior.list_price_override !== l.list_price_override || prior.discount_pct_override !== l.discount_pct_override;
          });

        let feederId = m.feeder.id;
        let forked = false;
        if (m.feeder.is_library && (feederFieldsChanged || linesChanged)) {
          if (currentUserId === undefined) {
            const {
              data: { user },
            } = await supabase.auth.getUser();
            currentUserId = user?.id;
          }
          const { data: newFeeder, error: forkError } = await supabase
            .from("feeders")
            .insert({
              name: m.feeder.name,
              description: m.feeder.description,
              category: m.feeder.category,
              tag: m.feeder.tag,
              rating_summary: m.feeder.rating_summary,
              rated_current: m.feeder.rated_current,
              pole_config: m.feeder.pole_config,
              breaking_capacity: m.feeder.breaking_capacity,
              switchboard_id: sb.id,
              is_library: false,
              created_by: currentUserId,
            })
            .select("id")
            .single();
          if (forkError || !newFeeder) throw forkError ?? new Error("Could not save customized feeder.");
          feederId = (newFeeder as { id: string }).id;
          forked = true;
          if (m.lines.length) {
            const { error: linesError } = await supabase.from("feeder_items").insert(
              m.lines.map((l, i) => ({
                feeder_id: feederId,
                item_id: l.item_id,
                qty: l.qty,
                sort_order: i,
                list_price_override: l.list_price_override,
                discount_pct_override: l.discount_pct_override,
              }))
            );
            if (linesError) throw linesError;
          }
        }

        if (isNewPlacement) {
          const vId = await ensureUnassignedVertical(supabase, sb.id);
          const { error } = await supabase
            .from("placed_feeders")
            .insert({ vertical_id: vId, feeder_id: feederId, qty: m.qty, tier_number: 1, sort_order: 0 });
          if (error) throw error;
        } else {
          const priorModule = saved.modules.find((x) => x.feeder.id === m.feeder.id)!;
          const placementPatch: { qty?: number; feeder_id?: string } = {};
          if (priorModule.qty !== m.qty) placementPatch.qty = m.qty;
          if (forked) placementPatch.feeder_id = feederId;
          if (Object.keys(placementPatch).length) {
            const { error } = await supabase.from("placed_feeders").update(placementPatch).eq("id", m.placementId);
            if (error) throw error;
          }

          if (!forked) {
            const feederPatch: Partial<Pick<Feeder, "name" | "tag" | "rating_summary">> & { updated_at?: string } = {};
            if (priorModule.feeder.name !== m.feeder.name) feederPatch.name = m.feeder.name;
            if (priorModule.feeder.tag !== m.feeder.tag) feederPatch.tag = m.feeder.tag;
            if (priorModule.feeder.rating_summary !== m.feeder.rating_summary) feederPatch.rating_summary = m.feeder.rating_summary;
            if (Object.keys(feederPatch).length) {
              feederPatch.updated_at = new Date().toISOString();
              const { error } = await supabase.from("feeders").update(feederPatch).eq("id", m.feeder.id);
              if (error) throw error;
            }
          }
        }

        if (!forked) {
          const draftLineIds = new Set(m.lines.map((l) => l.id));
          for (const l of m.baselineLines) {
            if (!draftLineIds.has(l.id)) {
              const { error } = await supabase.from("feeder_items").delete().eq("id", l.id);
              if (error) throw error;
            }
          }
          for (const [i, l] of m.lines.entries()) {
            if (l.id.startsWith("new-")) {
              const { error } = await supabase.from("feeder_items").insert({
                feeder_id: feederId,
                item_id: l.item_id,
                qty: l.qty,
                sort_order: i,
                list_price_override: l.list_price_override,
                discount_pct_override: l.discount_pct_override,
              });
              if (error) throw error;
            } else {
              const priorLine = m.baselineLines.find((x) => x.id === l.id);
              if (
                !priorLine ||
                priorLine.qty !== l.qty ||
                priorLine.list_price_override !== l.list_price_override ||
                priorLine.discount_pct_override !== l.discount_pct_override
              ) {
                const { error } = await supabase
                  .from("feeder_items")
                  .update({ qty: l.qty, sort_order: i, list_price_override: l.list_price_override, discount_pct_override: l.discount_pct_override })
                  .eq("id", l.id);
                if (error) throw error;
              }
            }
          }
        }
      }

      const fresh = await loadBomData(supabase, switchboardId);
      if (fresh) {
        setSb(fresh.switchboard);
        const freshDraft = toDraft(fresh);
        setSaved(freshDraft);
        setDraft(freshDraft);
        setLibraryFeedersAll(fresh.libraryFeedersAll);
        setResetKey((k) => k + 1);
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !sb || !draft) {
    return <div className="p-8 text-sm text-on-surface-variant">Loading...</div>;
  }

  const badges = [
    sb.std,
    sb.form_of_separation,
    sb.amps ? `${sb.amps}A` : null,
    sb.ka ? `${sb.ka}kA` : null,
    sb.ip_rating ? `IP${sb.ip_rating}` : null,
  ].filter((v): v is string => !!v);

  const draftFeederIds = new Set(draft.modules.map((m) => m.feeder.id));
  const libraryOptions = libraryFeedersAll.filter((f) => !draftFeederIds.has(f.id));
  const bomCategories = Array.from(
    new Set(draft.modules.flatMap((m) => m.lines.map((l) => l.item.category)).filter((c): c is string => !!c))
  ).sort();

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
        <div className="flex items-center gap-space-sm">
          {!readOnly && dirty && <span className="font-body-sm text-body-sm text-amber-600">Unsaved changes</span>}
          {!readOnly && !dirty && <span className="font-body-sm text-body-sm text-tertiary">Saved</span>}
          <button
            disabled
            title="Export coming soon"
            className="flex items-center gap-1 rounded bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
          >
            <Icon name="file_save" size={16} /> Export BOM (PDF/XLSX)
          </button>
          {!readOnly && (
            <>
              <button onClick={handleCancel} disabled={!dirty || saving} className="btn btn-outline">
                Cancel
              </button>
              <button onClick={handleSave} disabled={!dirty || saving} className="btn btn-primary">
                <Icon name="save" size={16} />
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <Icon name="visibility" size={15} />
          {revisionArchived ? "This revision is archived — read only." : "This switchboard is locked by another user — read only until it's released."}
        </div>
      )}

      <CostBreakdownCard key={resetKey} breakdown={breakdown} switchboard={{ labor_wiring_pct: draft.laborWiring, labor_assembly_pct: draft.laborAssembly, labor_testing_pct: draft.laborTesting }} readOnly={readOnly} onLaborChange={updateLaborPct} />

      {!readOnly && (
        <div className="flex flex-wrap items-start gap-3">
          <AddFromLibrary options={libraryOptions} onSelect={addLibraryFeeder} />
          <div className="flex-1">
            <AdHocFeederPanel switchboardId={sb.id} allItems={allItems} onCreated={handleAdHocCreated} />
          </div>
          {bomCategories.length > 0 && <CategoryDiscountTool categories={bomCategories} onApply={applyCategoryDiscount} />}
        </div>
      )}

      <div className="space-y-3">
        {draft.modules.map((mod) => (
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
            onLineOverrideChange={(lineId, field, value) => updateLineOverride(mod, lineId, field, value)}
            onRemoveLine={(lineId) => removeLine(mod, lineId)}
            onDuplicate={!readOnly ? () => duplicateModule(mod) : undefined}
            onDelete={!readOnly ? () => deleteModule(mod) : undefined}
            onPromote={!readOnly && !mod.feeder.is_library ? () => promoteToLibrary(mod) : undefined}
          />
        ))}
        {draft.modules.length === 0 && (
          <p className="rounded-xl border border-dashed border-surface-container-high py-10 text-center text-sm text-on-surface-variant">
            No feeders in this switchboard&apos;s BOM yet. Add one from the library or build a custom feeder above.
          </p>
        )}
      </div>

      <LineItemsSection title="1. Busbars" lines={draft.busbars} readOnly={readOnly} onAdd={addBusbar} onUpdate={updateBusbar} onRemove={removeBusbar} />
      <LineItemsSection
        title="2. Enclosure & Cubicle Construction"
        lines={draft.enclosureLines}
        readOnly={readOnly}
        onAdd={addEnclosureLine}
        onUpdate={updateEnclosureLine}
        onRemove={removeEnclosureLine}
      />
    </div>
  );
}

function AddFromLibrary({ options, onSelect }: { options: LibraryFeederOption[]; onSelect: (opt: LibraryFeederOption) => void }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const matches = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : options.slice(0, 8);

  return (
    <div className="relative w-72">
      <button onClick={() => setOpen(!open)} className="btn btn-outline w-full justify-between">
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

function CategoryDiscountTool({ categories, onApply }: { categories: string[]; onApply: (category: string, discountPct: number) => void }) {
  const [category, setCategory] = useState("");
  const [discount, setDiscount] = useState("");

  return (
    <div className="flex items-end gap-2 rounded-md border border-surface-container-high bg-surface-container-lowest px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <label className="font-label-sm text-[10px] uppercase tracking-wide text-secondary">Bulk Discount — Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="min-w-40 rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Select category...</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="font-label-sm text-[10px] uppercase tracking-wide text-secondary">Disc %</label>
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          className="w-16 rounded border border-surface-container-high px-1.5 py-1 text-right text-xs"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          if (!category || discount === "") return;
          onApply(category, Number(discount) || 0);
          setCategory("");
          setDiscount("");
        }}
        disabled={!category || discount === ""}
        className="btn btn-secondary btn-sm"
      >
        Apply
      </button>
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
  onLineOverrideChange,
  onRemoveLine,
  onDuplicate,
  onDelete,
  onPromote,
}: {
  mod: DraftModule;
  readOnly: boolean;
  canEditLines: boolean;
  allItems: ItemMaster[];
  onRename: (field: "name" | "tag" | "rating_summary", value: string) => void;
  onQtyChange: (qty: number) => void;
  onAddLine: (item: ItemMaster, qty: number) => void;
  onLineQtyChange: (lineId: string, qty: number) => void;
  onLineOverrideChange: (lineId: string, field: "list_price_override" | "discount_pct_override", value: number | null) => void;
  onRemoveLine: (lineId: string) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onPromote?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [categoryChip, setCategoryChip] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<{ id: string; label: string }[]>([]);

  const subtotal = mod.qty * lineTotal(mod.lines);

  const itemCategories = Array.from(new Set(allItems.map((i) => i.category).filter((c): c is string => !!c))).sort().slice(0, 8);

  const matches = itemSearch.trim()
    ? allItems
        .filter((i) => {
          if (categoryChip && i.category !== categoryChip) return false;
          const q = itemSearch.toLowerCase();
          return (
            itemCode(i).toLowerCase().includes(q) ||
            (i.vendor_cat ?? "").toLowerCase().includes(q) ||
            (i.make ?? "").toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q)
          );
        })
        .slice(0, 20)
    : [];

  function addItem(item: ItemMaster) {
    onAddLine(item, 1);
    setJustAdded((prev) => [{ id: item.id, label: `${itemCode(item)} — ${item.description}` }, ...prev].slice(0, 10));
    setItemSearch("");
  }

  function closeAddDialog() {
    setAddDialogOpen(false);
    setItemSearch("");
    setCategoryChip(null);
    setJustAdded([]);
  }

  const headerClass = mod.feeder.is_library
    ? "border-amber-100 bg-amber-50"
    : "border-emerald-100 bg-emerald-50";

  return (
    <div className="overflow-hidden rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs">
      <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${headerClass}`}>
        <button onClick={() => setExpanded(!expanded)} className="text-on-surface-variant hover:text-on-surface-variant">
          <Icon name={expanded ? "expand_less" : "expand_more"} size={18} />
        </button>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            disabled={readOnly || !canEditLines}
            value={mod.feeder.name}
            onChange={(e) => onRename("name", e.target.value)}
            className="min-w-40 rounded border-none bg-transparent px-1 py-0.5 text-sm font-semibold text-on-surface focus:bg-surface-container-lowest disabled:text-on-surface"
          />
          <input
            disabled={readOnly || !canEditLines}
            value={mod.feeder.tag ?? ""}
            onChange={(e) => onRename("tag", e.target.value)}
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
            value={mod.feeder.rating_summary ?? ""}
            onChange={(e) => onRename("rating_summary", e.target.value)}
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
            value={mod.qty}
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
              <button onClick={onDelete} title="Remove from BOM" className="text-error hover:text-error/70">
                <Icon name="delete" size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-3">
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide">
              <tr className="bg-primary text-on-primary">
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 py-1">Vendor Cat</th>
                <th className="px-2 py-1">Make</th>
                <th className="px-2 py-1">Category</th>
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
              {mod.lines.map((line, i) => {
                const listPrice = line.list_price_override ?? line.item.list_price;
                const discountPct = line.discount_pct_override ?? line.item.discount_pct;
                const netRate = effectiveNetRate(line.item, line.list_price_override, line.discount_pct_override);
                return (
                  <tr key={line.id} className="border-t border-surface-container">
                    <td className="px-2 py-1.5 text-on-surface-variant">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono">{line.item.sku || "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-secondary">{line.item.vendor_cat || "—"}</td>
                    <td className="px-2 py-1.5 text-on-surface-variant">{line.item.make || "—"}</td>
                    <td className="px-2 py-1.5 text-on-surface-variant">{line.item.category || "—"}</td>
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
                      {canEditLines ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={listPrice ?? ""}
                          placeholder="—"
                          onChange={(e) => onLineOverrideChange(line.id, "list_price_override", e.target.value === "" ? null : Number(e.target.value))}
                          className="w-20 rounded border border-surface-container-high px-1 py-0.5 text-right"
                        />
                      ) : listPrice != null ? (
                        money(listPrice)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-on-surface-variant">
                      {canEditLines ? (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={discountPct ?? ""}
                          placeholder="—"
                          onChange={(e) => onLineOverrideChange(line.id, "discount_pct_override", e.target.value === "" ? null : Number(e.target.value))}
                          className="w-16 rounded border border-surface-container-high px-1 py-0.5 text-right"
                        />
                      ) : discountPct != null ? (
                        `${discountPct}%`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-secondary">{money(netRate)}</td>
                    <td className="px-2 py-1.5 text-secondary">{line.item.uom}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(line.qty * netRate)}</td>
                    {canEditLines && (
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={() => onRemoveLine(line.id)} className="text-error hover:underline">
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {mod.lines.length === 0 && (
                <tr>
                  <td colSpan={canEditLines ? 13 : 12} className="px-2 py-4 text-center text-on-surface-variant">
                    No items in this feeder yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {canEditLines && (
            <button type="button" onClick={() => setAddDialogOpen(true)} className="btn btn-primary btn-sm mt-2">
              <Icon name="add" size={14} /> Add Item to Feeder
            </button>
          )}

          <div className="mt-2 flex items-center justify-end gap-3 border-t border-surface-container pt-2 text-xs text-secondary">
            <span>{mod.lines.length} items</span>
            <span className="font-semibold text-on-surface">Feeder Total: {money(subtotal)}</span>
          </div>
        </div>
      )}

      {addDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-space-md backdrop-blur-sm"
          onClick={closeAddDialog}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-surface-container-high bg-surface-container-low p-space-md">
              <div className="flex items-center gap-space-sm">
                <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-primary">
                  <Icon name="add_box" size={16} />
                </div>
                <div className="flex flex-col">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface">Add Item to Feeder</h3>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">{mod.feeder.name}</span>
                </div>
              </div>
              <button onClick={closeAddDialog} className="rounded p-1 text-secondary hover:bg-surface-container hover:text-on-surface">
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-space-sm p-space-md pb-0">
              <div className="relative flex items-center">
                <Icon name="search" size={16} className="pointer-events-none absolute left-2 text-secondary" />
                <input
                  autoFocus
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches.length > 0) {
                      e.preventDefault();
                      addItem(matches[0]);
                    }
                  }}
                  placeholder="Search by SKU, vendor cat, make or description... (Enter to add)"
                  autoComplete="off"
                  className="h-9 w-full rounded border border-surface-container-high bg-surface pl-8 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              {itemCategories.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setCategoryChip(null)}
                    className={`shrink-0 rounded-full px-2 py-0.5 transition-colors ${
                      categoryChip === null ? "bg-primary font-semibold text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                    }`}
                  >
                    All
                  </button>
                  {itemCategories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryChip(c)}
                      className={`shrink-0 rounded-full px-2 py-0.5 transition-colors ${
                        categoryChip === c ? "bg-primary font-semibold text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-space-md pt-2">
              {matches.length === 0 ? (
                <p className="py-6 text-center text-xs text-on-surface-variant">
                  {itemSearch ? "No matching items." : "Start typing to search the item master."}
                </p>
              ) : (
                <div className="divide-y divide-surface-container rounded border border-surface-container-high">
                  {matches.map((m, i) => (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => addItem(m)}
                      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface-container-low ${i === 0 ? "bg-primary/5" : ""}`}
                    >
                      <span className="w-24 shrink-0 truncate font-mono text-secondary">{itemCode(m)}</span>
                      <span className="w-24 shrink-0 truncate font-mono text-secondary">{m.vendor_cat || "—"}</span>
                      <span className="w-28 shrink-0 truncate text-on-surface-variant">{m.make || "—"}</span>
                      <span className="min-w-0 flex-1 truncate">{m.description}</span>
                      <Icon name="add" size={14} className="shrink-0 text-primary" />
                    </button>
                  ))}
                </div>
              )}

              {justAdded.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Added this session</p>
                  <ul className="space-y-1">
                    {justAdded.map((a, i) => (
                      <li key={`${a.id}-${i}`} className="flex items-center gap-1 rounded bg-tertiary-container/15 px-2 py-1 text-xs text-tertiary">
                        <Icon name="check_circle" size={13} />
                        <span className="truncate">{a.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-surface-container-high p-space-md">
              <button type="button" onClick={closeAddDialog} className="btn btn-primary btn-sm">
                Done
              </button>
            </div>
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
