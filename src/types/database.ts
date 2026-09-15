// Hand-written row types matching supabase/migrations/0001_init.sql,
// 0002_workflow_features.sql and 0003_switchboard_hierarchy.sql. (If you
// later install the Supabase CLI you can generate these automatically with
// `supabase gen types typescript`.)

export type Profile = {
  id: string;
  full_name: string | null;
  role: "admin" | "sales";
  created_at: string;
};

export type ItemStatus = "active" | "inactive" | "discontinued";

export type ItemMaster = {
  id: string;
  sku: string | null;
  vendor_cat: string | null;
  description: string;
  category: string | null;
  make: string | null;
  status: ItemStatus;
  amps: number | null;
  ka: number | null;
  poles: number | null;
  uom: string;
  unit_cost: number;
  list_price: number | null;
  discount_pct: number | null;
  supplier: string | null;
  notes: string | null;
  updated_at: string;
};

export type Feeder = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tag: string | null;
  rating_summary: string | null;
  switchboard_id: string | null;
  is_library: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FeederItem = {
  id: string;
  feeder_id: string;
  item_id: string;
  qty: number;
  created_at: string;
};

export type FeederItemWithDetails = FeederItem & { item: ItemMaster };

// Top-level container (e.g. "PRJ-24-089"). Belongs to a customer, holds
// one or more revisions.
export type Customer = {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
};

export type Project = {
  id: string;
  customer_id: string | null;
  code: string;
  title: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

// A revision is a snapshot of a project (Rev 01, Rev 02, ...) and is the
// unit that gets locked/archived. Holds one or more switchboards.
export type Revision = {
  id: string;
  project_id: string;
  name: string;
  customer_name: string | null;
  status: "draft" | "quoted" | "won" | "lost";
  margin_pct: number;
  created_by: string | null;
  locked_by: string | null;
  locked_at: string | null;
  archived: boolean;
  revision_number: number;
  revision_group_id: string;
  freight_amount: number;
  freight_description: string | null;
  installation_amount: number;
  installation_description: string | null;
  commissioning_amount: number;
  commissioning_description: string | null;
  created_at: string;
  updated_at: string;
};

// A physical switchboard within a revision — the unit that has its own
// BOM (feeders/items) and GA (bays/tiers).
export type Switchboard = {
  id: string;
  revision_id: string;
  tag: string;
  title: string | null;
  form_of_separation: string | null;
  plinth_height_mm: number | null;
  panel_height_mm: number | null;
  amps: number | null;
  ka: number | null;
  poles: number | null;
  sort_order: number;
  labor_wiring_pct: number;
  labor_assembly_pct: number;
  labor_testing_pct: number;
  profit_pct: number;
  created_at: string;
};

// flat editable line-item rows for the BOM Builder's Busbars and
// Enclosure & Cubicle Construction sections
export type SwitchboardBusbarLine = {
  id: string;
  switchboard_id: string;
  description: string;
  qty: number;
  rate: number;
  sort_order: number;
  created_at: string;
};

export type SwitchboardEnclosureLine = {
  id: string;
  switchboard_id: string;
  description: string;
  qty: number;
  rate: number;
  sort_order: number;
  created_at: string;
};

export type BayType = "incomer" | "outgoing" | "riser" | "bus_coupler" | "spare" | "unassigned";

// a "vertical" is one bay/column of a switchboard's GA
export type Vertical = {
  id: string;
  switchboard_id: string;
  name: string;
  width_mm: number | null;
  depth_mm: number | null;
  bay_type: BayType | null;
  sort_order: number;
  created_at: string;
};

// a feeder placed inside a bay, stacked into a tier
export type PlacedFeeder = {
  id: string;
  vertical_id: string;
  feeder_id: string;
  label_override: string | null;
  qty: number;
  sort_order: number;
  tier_number: number;
  created_at: string;
};

// Minimal placeholder so @supabase/ssr's generic client type-checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
