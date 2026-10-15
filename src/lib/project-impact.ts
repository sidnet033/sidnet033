import type { createClient } from "@/lib/supabase/client";
import type {
  Feeder,
  PlacedFeeder,
  Switchboard,
  Vertical,
} from "@/types/database";
import { lookupAcbBaySpec, suggestAcbFrame } from "@/lib/artuk-sizing";
import {
  KIND_LABELS,
  barArea,
  bayFunctionOf,
  formatBar,
  isIncomerFeeder,
  isStockedBar,
  type BarSize,
  type BusbarKind,
  type BusbarMaterial,
  type BusbarOverride,
  type BusbarSegment,
} from "@/lib/busbar-plan";
import {
  BUSBAR_CHAMBER_HEIGHT_MM,
  DEFAULT_PANEL_HEIGHT_MM,
  artukBaySize,
  overridesFromRows,
  planForSwitchboard,
  type BusbarOverrideRow,
  type VerticalWithFeeders,
} from "@/lib/ga-layout";

// Project-wide consistency checks: what a change to project/switchboard
// parameters (busbar current density, material, Amps, kA, Std, ...) does to
// every switchboard's GA and busbars, and which existing choices now
// conflict with those parameters. Used by Project Detail for the Save-time
// review and the standing Alerts section.

type Supabase = ReturnType<typeof createClient>;

export type Densities = Record<BusbarMaterial, number>;

export type FeederItemRating = { itemId: string; description: string; ka: number | null };

export type BoardData = {
  revision: { id: string; label: string };
  switchboard: Switchboard;
  verticals: VerticalWithFeeders[];
  overrides: Record<string, BusbarOverride>;
  // item lines of each feeder used on the board (for the kA check)
  feederItems: Record<string, FeederItemRating[]>;
};

export type ProjectData = { boards: BoardData[] };

// Switchboard fields whose change can alter the GA, busbars or what's
// flagged -- anything else saves without a review.
export const IMPACT_FIELDS = [
  "amps",
  "busbar",
  "neutral_size_pct",
  "cable_entry",
  "std",
  "ka",
  "ip_rating",
  "form_of_separation",
] as const satisfies readonly (keyof Switchboard)[];

type SegmentRef = Pick<
  BusbarOverride,
  "kind" | "verticalId" | "placedFeederId" | "unitIndex"
>;

export type FixAction =
  // Drop a hand-set bar size/runs so the segment follows the project rules.
  | { type: "reset_bar"; switchboardId: string; segment: SegmentRef }
  // Store the given bar size/runs as an override (keeps a bar as it was).
  | {
      type: "pin_bar";
      switchboardId: string;
      segment: SegmentRef;
      bar: BarSize;
      runs: number;
    }
  | {
      type: "resize_bay";
      switchboardId: string;
      verticalId: string;
      widthMm: number;
      depthMm: number;
    };

// alert: conflicts with the project/switchboard settings -- blocks saving
// until fixed. warning: worth checking, but saving is allowed. change: a
// line in the Save-time review describing what the save will do.
export type Severity = "alert" | "warning" | "change";

// One line in the review dialog / Alerts list. Ticked runs `apply`,
// unticked runs `keep`; a line with neither is information only (it needs a
// manual fix somewhere else in the app).
export type ReviewItem = {
  id: string;
  switchboardId: string;
  boardLabel: string;
  revisionLabel: string;
  area: "Busbars" | "GA" | "BOM";
  severity: Severity;
  message: string;
  apply: FixAction | null;
  keep: FixAction | null;
  applyLabel: string | null;
  blockedReason: string | null;
  // review lines only: what leaving it unticked would leave behind (an
  // undersized bar is an alert, so the save can't go ahead with it)
  keepSeverity?: "alert" | null;
};

export async function loadProjectData(
  supabase: Supabase,
  projectId: string,
): Promise<ProjectData> {
  // Archived revisions are read-only snapshots -- nothing there can be
  // changed, so they're left out of the checks.
  const { data: revisions } = await supabase
    .from("revisions")
    .select("id, name, revision_number, archived")
    .eq("project_id", projectId)
    .eq("archived", false)
    .order("revision_number");
  const revs = (revisions ?? []) as {
    id: string;
    name: string;
    revision_number: number;
  }[];
  if (revs.length === 0) return { boards: [] };

  const { data: sbRows } = await supabase
    .from("switchboards")
    .select("*")
    .in(
      "revision_id",
      revs.map((r) => r.id),
    )
    .order("sort_order");
  const switchboards = (sbRows ?? []) as Switchboard[];
  if (switchboards.length === 0) return { boards: [] };
  const sbIds = switchboards.map((s) => s.id);

  const [{ data: vRows }, { data: oRows }] = await Promise.all([
    supabase
      .from("verticals")
      .select("*")
      .in("switchboard_id", sbIds)
      .order("sort_order"),
    supabase.from("busbar_overrides").select("*").in("switchboard_id", sbIds),
  ]);
  const verticals = (vRows ?? []) as Vertical[];
  const vIds = verticals.map((v) => v.id);
  const { data: pRows } = vIds.length
    ? await supabase
        .from("placed_feeders")
        .select("*, feeder:feeders(*)")
        .in("vertical_id", vIds)
        .order("sort_order")
    : { data: [] };
  const placed = (pRows ?? []) as unknown as (PlacedFeeder & {
    feeder: Feeder;
  })[];
  const overrideRows = (oRows ?? []) as (BusbarOverrideRow & {
    switchboard_id: string;
  })[];

  const feederIds = [...new Set(placed.map((p) => p.feeder_id))];
  const { data: fiRows } = feederIds.length
    ? await supabase.from("feeder_items").select("feeder_id, item:item_master(id, description, ka)").in("feeder_id", feederIds)
    : { data: [] };
  const feederItems: Record<string, FeederItemRating[]> = {};
  for (const r of (fiRows ?? []) as unknown as { feeder_id: string; item: { id: string; description: string; ka: number | null } | null }[]) {
    if (!r.item) continue;
    (feederItems[r.feeder_id] ??= []).push({ itemId: r.item.id, description: r.item.description, ka: r.item.ka != null ? Number(r.item.ka) : null });
  }

  const multipleNames = new Set(revs.map((r) => r.name)).size > 1;
  return {
    boards: switchboards.map((sb) => {
      const rev = revs.find((r) => r.id === sb.revision_id)!;
      return {
        revision: {
          id: rev.id,
          label: multipleNames
            ? `${rev.name} · Rev ${rev.revision_number}`
            : `Rev ${rev.revision_number}`,
        },
        switchboard: sb,
        verticals: verticals
          .filter((v) => v.switchboard_id === sb.id)
          .map((v) => ({
            ...v,
            placed: placed.filter((p) => p.vertical_id === v.id),
          })),
        overrides: overridesFromRows(
          overrideRows.filter((r) => r.switchboard_id === sb.id),
        ),
        feederItems,
      };
    }),
  };
}

function boardLabel(sb: Switchboard): string {
  return sb.title ? `${sb.tag} · ${sb.title}` : sb.tag;
}

function planOf(board: BoardData, densities: Densities) {
  const sb = board.switchboard;
  return planForSwitchboard({
    params: sb,
    verticals: board.verticals,
    overrides: board.overrides,
    densities,
    panelHeightMm: sb.panel_height_mm ?? DEFAULT_PANEL_HEIGHT_MM,
    chamberHeightMm: sb.busbar_chamber_height_mm ?? BUSBAR_CHAMBER_HEIGHT_MM,
  });
}

function segmentRef(seg: BusbarSegment): SegmentRef {
  return {
    kind: seg.kind,
    verticalId: seg.verticalId,
    placedFeederId: seg.placedFeederId,
    unitIndex: seg.unitIndex,
  };
}

function segmentName(seg: BusbarSegment): string {
  return seg.title || KIND_LABELS[seg.kind as BusbarKind];
}

function sameSize(
  a: { bar: BarSize; runs: number } | null,
  b: { bar: BarSize; runs: number } | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.runs === b.runs &&
    a.bar.widthMm === b.bar.widthMm &&
    a.bar.thicknessMm === b.bar.thicknessMm
  );
}

// "50kA", "65 kA", "50" -> number
function parseKa(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function blockedReasonFor(
  sb: Switchboard,
  currentUserId: string,
  isAdmin: boolean,
): string | null {
  if (sb.locked_by && sb.locked_by !== currentUserId && !isAdmin)
    return "Locked by another user — they need to release it first.";
  return null;
}

// Everything on a board that conflicts with (or departs from) its project
// and switchboard parameters right now.
export function auditBoard(
  board: BoardData,
  densities: Densities,
  currentUserId: string,
  isAdmin: boolean,
): ReviewItem[] {
  const sb = board.switchboard;
  const material: BusbarMaterial = sb.busbar ?? "Cu";
  const base = {
    switchboardId: sb.id,
    boardLabel: boardLabel(sb),
    revisionLabel: board.revision.label,
    keep: null,
    blockedReason: blockedReasonFor(sb, currentUserId, isAdmin),
  };
  const items: ReviewItem[] = [];
  const placedBays = board.verticals.filter(
    (v) => v.bay_type !== "unassigned" && v.placed.length > 0,
  );
  if (placedBays.length === 0) return items;

  const plan = planOf(board, densities);
  for (const seg of plan.segments) {
    if (seg.kind === "main" && seg.designCurrentA == null) {
      items.push({
        ...base,
        id: `${sb.id}|main-unrated`,
        area: "Busbars",
        severity: "alert",
        message:
          "Main busbar can't be sized — set the switchboard's Amps (or an incomer rating).",
        apply: null,
        applyLabel: null,
      });
      continue;
    }
    if (!seg.overridden.size && !seg.overridden.runs) continue;
    const current = seg.bar ? formatBar(seg.bar, seg.runs) : "—";
    const rule = seg.auto ? formatBar(seg.auto.bar, seg.auto.runs) : null;
    const notStocked = !!seg.bar && !isStockedBar(material, seg.bar);
    if (
      !seg.undersized &&
      !notStocked &&
      (!seg.auto || sameSize({ bar: seg.bar!, runs: seg.runs }, seg.auto))
    )
      continue;
    let message: string;
    let severity: Severity = "warning";
    if (seg.undersized) {
      severity = "alert";
      message = `${segmentName(seg)} is set by hand to ${current} — carries ${seg.capacityA}A at ${densities[material]} A/mm², needs ${seg.designCurrentA}A.`;
    } else if (notStocked) {
      message = `${segmentName(seg)} is set to ${current}, which isn't a stocked ${material} size.`;
    } else {
      message = `${segmentName(seg)} is set by hand to ${current}; project rules give ${rule}.`;
    }
    items.push({
      ...base,
      id: `${sb.id}|bar|${seg.key}`,
      area: "Busbars",
      severity,
      message,
      apply: {
        type: "reset_bar",
        switchboardId: sb.id,
        segment: segmentRef(seg),
      },
      applyLabel: rule ? `Change to ${rule}` : "Reset to auto size",
    });
  }

  // feeders, once each even when placed in several bays/units
  const seen = new Set<string>();
  const seenItems = new Set<string>();
  for (const v of placedBays) {
    for (const p of v.placed) {
      const f = p.feeder;
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (
        sb.amps != null &&
        f.rated_current != null &&
        isIncomerFeeder(f, v.bay_type) &&
        f.rated_current < sb.amps
      ) {
        items.push({
          ...base,
          id: `${sb.id}|incomer-amps|${f.id}`,
          area: "BOM",
          severity: "alert",
          message: `Incomer "${f.name}" is rated ${f.rated_current}A but the switchboard is ${sb.amps}A — change the feeder in BOM Builder.`,
          apply: null,
          applyLabel: null,
        });
      }
      if (sb.amps != null && f.rated_current != null && f.rated_current > sb.amps) {
        items.push({
          ...base,
          id: `${sb.id}|feeder-over-amps|${f.id}`,
          area: "BOM",
          severity: "alert",
          message: `"${f.name}" is rated ${f.rated_current}A, above the switchboard's ${sb.amps}A — raise the switchboard's Amps or change the feeder.`,
          apply: null,
          applyLabel: null,
        });
      }
      // kA below the switchboard's fault level is a warning, not an alert:
      // checked on the feeder's own items (breakers carry their kA), and on
      // the feeder's breaking capacity when none of its items has one.
      const rated = (board.feederItems[f.id] ?? []).filter((i) => i.ka != null);
      if (sb.ka != null) {
        for (const item of rated) {
          if (item.ka! >= sb.ka || seenItems.has(item.itemId)) continue;
          seenItems.add(item.itemId);
          items.push({
            ...base,
            id: `${sb.id}|item-ka|${item.itemId}`,
            area: "BOM",
            severity: "warning",
            message: `"${item.description}" (in ${f.name}) is rated ${item.ka}kA, below the switchboard's ${sb.ka}kA fault level.`,
            apply: null,
            applyLabel: null,
          });
        }
      }
      const ka = parseKa(f.breaking_capacity);
      if (
        rated.length === 0 &&
        sb.ka != null &&
        ka != null &&
        (f.device_type === "ACB" || f.device_type === "MCCB") &&
        ka < sb.ka
      ) {
        items.push({
          ...base,
          id: `${sb.id}|ka|${f.id}`,
          area: "BOM",
          severity: "warning",
          message: `"${f.name}" breaks ${ka}kA but the switchboard fault level is ${sb.ka}kA — change the feeder in BOM Builder.`,
          apply: null,
          applyLabel: null,
        });
      }
    }
  }

  if (sb.std === "ArTuK") {
    const boardIp = sb.ip_rating ? Number(sb.ip_rating) : null;
    for (const v of placedBays) {
      const size = artukBaySize(v);
      if (
        size &&
        (v.width_mm !== size.widthMm || v.depth_mm !== size.depthMm)
      ) {
        items.push({
          ...base,
          id: `${sb.id}|bay-size|${v.id}`,
          area: "GA",
          severity: "warning",
          message: `Bay "${v.name}" is ${v.width_mm ?? "—"}W × ${v.depth_mm ?? "—"}D mm; ArTu-K needs ${size.widthMm}W × ${size.depthMm}D.`,
          apply: {
            type: "resize_bay",
            switchboardId: sb.id,
            verticalId: v.id,
            widthMm: size.widthMm,
            depthMm: size.depthMm,
          },
          applyLabel: `Resize to ${size.widthMm} × ${size.depthMm}`,
        });
      }
      const acb = v.placed.find(
        (p) => p.feeder.device_type === "ACB" && p.feeder.rated_current != null,
      );
      if (acb && boardIp != null && !Number.isNaN(boardIp)) {
        const spec = lookupAcbBaySpec(
          suggestAcbFrame(acb.feeder.rated_current!),
          bayFunctionOf(acb.feeder) ?? "outgoing",
        );
        if (spec && spec.ipRating < boardIp) {
          items.push({
            ...base,
            id: `${sb.id}|ip|${v.id}`,
            area: "GA",
            severity: "warning",
            message: `Bay "${v.name}" (${spec.frame} ArTu-K) is only rated IP${spec.ipRating}; the switchboard calls for IP${boardIp}.`,
            apply: null,
            applyLabel: null,
          });
        }
      }
    }
  }

  return items;
}

export function alertsOnly(items: ReviewItem[]): ReviewItem[] {
  return items.filter((i) => i.severity === "alert");
}

// The alerts this revision would have after the drafted changes are saved --
// any left means the save is refused.
export function alertsAfterSave(args: {
  data: ProjectData;
  densities: Densities;
  draftBoards: Map<string, Partial<Switchboard>>;
  revisionId: string;
  currentUserId: string;
  isAdmin: boolean;
}): ReviewItem[] {
  return alertsOnly(
    args.data.boards
      .filter((b) => b.revision.id === args.revisionId)
      .flatMap((b) => auditBoard(withDraft(b, args.draftBoards.get(b.switchboard.id)), args.densities, args.currentUserId, args.isAdmin))
  );
}

export function auditProject(
  data: ProjectData,
  densities: Densities,
  currentUserId: string,
  isAdmin: boolean,
): ReviewItem[] {
  return data.boards.flatMap((b) =>
    auditBoard(b, densities, currentUserId, isAdmin),
  );
}

function withDraft(
  board: BoardData,
  draft: Partial<Switchboard> | undefined,
): BoardData {
  return draft
    ? { ...board, switchboard: { ...board.switchboard, ...draft } }
    : board;
}

// What saving would do: auto-sized bars that change size (ticked = accept
// the new size, unticked = keep the old one as a hand-set size), plus any
// conflict the change creates. Pre-existing conflicts aren't repeated --
// they're already in the Alerts section.
export function computeImpact(args: {
  data: ProjectData;
  before: Densities;
  after: Densities;
  draftBoards: Map<string, Partial<Switchboard>>;
  currentUserId: string;
  isAdmin: boolean;
}): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const board of args.data.boards) {
    const draft = args.draftBoards.get(board.switchboard.id);
    const next = withDraft(board, draft);
    const densityChanged =
      args.before.Cu !== args.after.Cu || args.before.Al !== args.after.Al;
    const fieldsChanged =
      !!draft &&
      IMPACT_FIELDS.some(
        (k) => k in draft && draft[k] !== board.switchboard[k],
      );
    if (!densityChanged && !fieldsChanged) continue;

    const sb = next.switchboard;
    const blockedReason = blockedReasonFor(
      sb,
      args.currentUserId,
      args.isAdmin,
    );
    const beforePlan = planOf(board, args.before);
    const afterPlan = planOf(next, args.after);
    const beforeByKey = new Map(beforePlan.segments.map((s) => [s.key, s]));
    for (const seg of afterPlan.segments) {
      if (seg.overridden.size || seg.overridden.runs) continue;
      const prev = beforeByKey.get(seg.key);
      if (!prev || !prev.auto || !seg.auto || sameSize(prev.auto, seg.auto))
        continue;
      const from = formatBar(prev.auto.bar, prev.auto.runs);
      const keptCapacity = barArea(prev.auto.bar) * prev.auto.runs * args.after[sb.busbar ?? "Cu"];
      const to = formatBar(seg.auto.bar, seg.auto.runs);
      items.push({
        id: `${sb.id}|resize|${seg.key}`,
        switchboardId: sb.id,
        boardLabel: boardLabel(sb),
        revisionLabel: board.revision.label,
        area: "Busbars",
        severity: "change",
        message: `${segmentName(seg)}: ${from} → ${to}${seg.designCurrentA != null ? ` (${seg.designCurrentA}A)` : ""}.`,
        apply: null,
        keep: {
          type: "pin_bar",
          switchboardId: sb.id,
          segment: segmentRef(seg),
          bar: prev.auto.bar,
          runs: prev.auto.runs,
        },
        applyLabel: `Use ${to}`,
        blockedReason,
        keepSeverity: seg.designCurrentA != null && keptCapacity < seg.designCurrentA ? "alert" : null,
      });
    }

    const existing = new Set(
      auditBoard(board, args.before, args.currentUserId, args.isAdmin).map(
        (i) => i.id,
      ),
    );
    for (const item of auditBoard(
      next,
      args.after,
      args.currentUserId,
      args.isAdmin,
    )) {
      if (!existing.has(item.id)) items.push(item);
    }
  }
  return items;
}

async function findOverride(
  supabase: Supabase,
  switchboardId: string,
  seg: SegmentRef,
) {
  let q = supabase
    .from("busbar_overrides")
    .select("id, length_mm")
    .eq("switchboard_id", switchboardId)
    .eq("kind", seg.kind)
    .eq("unit_index", seg.unitIndex);
  q = seg.verticalId
    ? q.eq("vertical_id", seg.verticalId)
    : q.is("vertical_id", null);
  q = seg.placedFeederId
    ? q.eq("placed_feeder_id", seg.placedFeederId)
    : q.is("placed_feeder_id", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; length_mm: number | null } | null;
}

export async function applyActions(
  supabase: Supabase,
  actions: FixAction[],
): Promise<void> {
  for (const a of actions) {
    if (a.type === "resize_bay") {
      const { error } = await supabase
        .from("verticals")
        .update({ width_mm: a.widthMm, depth_mm: a.depthMm })
        .eq("id", a.verticalId);
      if (error) throw new Error(error.message);
      continue;
    }
    const row = await findOverride(supabase, a.switchboardId, a.segment);
    const now = new Date().toISOString();
    if (a.type === "reset_bar") {
      if (!row) continue;
      // keep a hand-set length; drop the row entirely when nothing else is set
      const { error } =
        row.length_mm != null
          ? await supabase
              .from("busbar_overrides")
              .update({
                bar_width_mm: null,
                bar_thickness_mm: null,
                runs_per_phase: null,
                updated_at: now,
              })
              .eq("id", row.id)
          : await supabase.from("busbar_overrides").delete().eq("id", row.id);
      if (error) throw new Error(error.message);
      continue;
    }
    const sizeFields = {
      bar_width_mm: a.bar.widthMm,
      bar_thickness_mm: a.bar.thicknessMm,
      runs_per_phase: a.runs,
      updated_at: now,
    };
    const { error } = row
      ? await supabase
          .from("busbar_overrides")
          .update(sizeFields)
          .eq("id", row.id)
      : await supabase.from("busbar_overrides").insert({
          switchboard_id: a.switchboardId,
          kind: a.segment.kind,
          vertical_id: a.segment.verticalId,
          placed_feeder_id: a.segment.placedFeederId,
          unit_index: a.segment.unitIndex,
          ...sizeFields,
        });
    if (error) throw new Error(error.message);
  }
}

// The actions a set of review lines resolves to, given which are ticked.
// Blocked lines do nothing.
export function actionsFor(
  items: ReviewItem[],
  ticked: Set<string>,
): FixAction[] {
  const out: FixAction[] = [];
  for (const i of items) {
    if (i.blockedReason) continue;
    const a = ticked.has(i.id) ? i.apply : i.keep;
    if (a) out.push(a);
  }
  return out;
}
