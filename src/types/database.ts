// Hand-written row types matching supabase/migrations/0001_init.sql and
// 0002_workflow_features.sql. (If you later install the Supabase CLI you
// can generate these automatically with `supabase gen types typescript`.)

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
  supplier: string | null;
  notes: string | null;
  updated_at: string;
};

export type Feeder = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  project_id: string | null;
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

export type Project = {
  id: string;
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
  created_at: string;
  updated_at: string;
};

export type Vertical = {
  id: string;
  project_id: string;
  name: string;
  width_mm: number | null;
  sort_order: number;
  created_at: string;
};

export type PlacedFeeder = {
  id: string;
  vertical_id: string;
  feeder_id: string;
  label_override: string | null;
  qty: number;
  sort_order: number;
  created_at: string;
};

// Minimal placeholder so @supabase/ssr's generic client type-checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
