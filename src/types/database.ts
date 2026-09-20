// Hand-written row types matching supabase/migrations/0001_init.sql,
// 0002_workflow_features.sql and 0003_switchboard_hierarchy.sql. (If you
// later install the Supabase CLI you can generate these automatically with
// `supabase gen types typescript`.)

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "admin" | "sales";
  role_id: string | null;
  status: "invited" | "active";
  disabled: boolean;
  created_at: string;
};

// Custom roles are a management layer over the create/edit/delete matrix
// below. They don't yet drive real access control anywhere in the app --
// that still runs on Profile.role via is_admin(). See migration 0009.
export type Role = {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
};

export type RolePermission = {
  id: string;
  role_id: string;
  resource: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_archive: boolean;
};

export type ItemStatus = "active" | "inactive" | "discontinued";

export type ImportLog = {
  id: string;
  source: "xlsx_upload" | "google_sheet_sync";
  file_name: string | null;
  created_count: number;
  updated_count: number;
  failed_count: number;
  failures: { row: number; reason: string }[];
  imported_by: string | null;
  imported_by_name: string | null;
  created_at: string;
};

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
  rated_current: number | null;
  pole_config: string | null;
  breaking_capacity: string | null;
};

export type FeederItem = {
  id: string;
  feeder_id: string;
  item_id: string;
  qty: number;
  sort_order: number;
  created_at: string;
  list_price_override: number | null;
  discount_pct_override: number | null;
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

export type ProjectStage = "new" | "wip" | "quoted" | "finalization" | "won" | "lost" | "hold" | "budgetary";

export type Project = {
  id: string;
  customer_id: string | null;
  code: string;
  title: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  crm_enquiry_number: string | null;
  crm_enquiry_date: string | null;
  site_country: string | null;
  consultant_id: string | null;
  sales_exec_id: string | null;
  stage: ProjectStage;
  owner_id: string | null;
  currency: string;
  exchange_rate: number;
};

export type Consultant = { id: string; name: string; created_by: string | null; created_at: string };
export type SalesExec = { id: string; name: string; created_by: string | null; created_at: string };
export type SwitchboardType = { id: string; name: string; created_by: string | null; created_at: string };

// A revision is a snapshot of a project (Rev 01, Rev 02, ...) — its only
// per-revision state is "archived" (read-only for everyone). Holds one or
// more switchboards, which are what actually get locked for editing.
export type Revision = {
  id: string;
  project_id: string;
  name: string;
  customer_name: string | null;
  status: "draft" | "quoted" | "won" | "lost";
  margin_pct: number;
  created_by: string | null;
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
// BOM (feeders/items), GA (bays/tiers) and lock (one user edits it at a
// time; other switchboards in the same revision stay free).
export type Switchboard = {
  id: string;
  revision_id: string;
  tag: string;
  title: string | null;
  description: string | null;
  switchboard_type_id: string | null;
  form_of_separation: string | null;
  plinth_height_mm: number | null;
  panel_height_mm: number | null;
  amps: number | null;
  ka: number | null;
  ip_rating: string | null;
  poles: number | null;
  std: "ArTuK" | "61439" | "60439" | null;
  qty: number;
  sort_order: number;
  labor_wiring_pct: number;
  labor_assembly_pct: number;
  labor_testing_pct: number;
  profit_pct: number;
  locked_by: string | null;
  locked_at: string | null;
  updated_at: string;
  updated_by: string | null;
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
