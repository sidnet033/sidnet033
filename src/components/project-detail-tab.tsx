"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { LookupSelect } from "@/components/lookup-select";
import { StageStepper } from "@/components/stage-stepper";
import { COUNTRIES } from "@/lib/countries";
import { CURRENCIES } from "@/lib/currencies";
import { formatMoney } from "@/lib/money";
import type { SwitchboardListItem } from "@/lib/revision-context";
import type { Customer, Project, ProjectStage, Revision, Switchboard } from "@/types/database";
import type { Tab } from "@/components/revision-workspace";

const STD_OPTIONS = ["ArTuK", "61439", "60439"] as const;
const IP_OPTIONS = ["42", "52", "54", "55", "63"];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type ProjectPatch = {
  title: string;
  notes: string | null;
  crm_enquiry_number: string | null;
  crm_enquiry_date: string | null;
  site_country: string | null;
  consultant_id: string | null;
  sales_exec_id: string | null;
  stage: ProjectStage;
  customer_id: string | null;
  owner_id: string | null;
  currency: string;
  exchange_rate: number;
};

function snapshotOf(project: Project): ProjectPatch {
  return {
    title: project.title,
    notes: project.notes,
    crm_enquiry_number: project.crm_enquiry_number,
    crm_enquiry_date: project.crm_enquiry_date,
    site_country: project.site_country,
    consultant_id: project.consultant_id,
    sales_exec_id: project.sales_exec_id,
    stage: project.stage,
    customer_id: project.customer_id,
    owner_id: project.owner_id,
    currency: project.currency,
    exchange_rate: project.exchange_rate,
  };
}

export function ProjectDetailTab({
  project,
  revision,
  customer,
  createdByName,
  consultantName,
  salesExecName,
  ownerName,
  allUsers,
  switchboards,
  currentUserId,
  isAdmin,
  revisionId,
  revisionArchived,
  onOpenSwitchboard,
  onSwitchboardDeleted,
}: {
  project: Project;
  revision: Revision;
  customer: Customer | null;
  createdByName: string | null;
  consultantName: string | null;
  salesExecName: string | null;
  ownerName: string | null;
  allUsers: { id: string; full_name: string | null; email: string | null }[];
  switchboards: SwitchboardListItem[];
  currentUserId: string;
  isAdmin: boolean;
  revisionId: string;
  revisionArchived: boolean;
  onOpenSwitchboard: (switchboardId: string, tab?: Tab) => void;
  onSwitchboardDeleted: (switchboardId: string) => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [savedSnapshot, setSavedSnapshot] = useState<ProjectPatch>(() => snapshotOf(project));
  const [form, setForm] = useState<ProjectPatch>(savedSnapshot);
  const [consultantLabel, setConsultantLabel] = useState(consultantName);
  const [salesExecLabel, setSalesExecLabel] = useState(salesExecName);
  const [customerLabel, setCustomerLabel] = useState(customer?.name ?? "");
  const [ownerLabel, setOwnerLabel] = useState(ownerName);
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(savedSnapshot);
  const money = (n: number) => formatMoney(n, form.currency, form.exchange_rate);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("customers").select("*").order("name");
      if (!cancelled) setCustomerOptions((data ?? []) as Customer[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, isAdmin]);

  function patch<K extends keyof ProjectPatch>(field: K, value: ProjectPatch[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setJustSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase.from("projects").update(form).eq("id", project.id);
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setSavedSnapshot(form);
    setJustSaved(true);
  }

  // switchboard table: local optimistic state so field edits (which fire on
  // every blur) never need a full-page refresh, which is what was causing
  // the "Failed to fetch" errors on this table.
  const [prevSwitchboards, setPrevSwitchboards] = useState(switchboards);
  const [boards, setBoards] = useState(switchboards);
  if (switchboards !== prevSwitchboards) {
    setPrevSwitchboards(switchboards);
    setBoards(switchboards);
  }

  const [typeOptions, setTypeOptions] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("switchboard_types").select("id, name").order("name");
      if (!cancelled) setTypeOptions((data ?? []) as { id: string; name: string }[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  async function handleLockAndOpen(switchboardId: string, alreadyLockedByMe: boolean) {
    if (!alreadyLockedByMe) {
      setBusyId(switchboardId);
      const { error } = await supabase.rpc("lock_switchboard", { p_switchboard_id: switchboardId });
      setBusyId(null);
      if (error) {
        alert(error.message);
        return;
      }
    }
    onOpenSwitchboard(switchboardId, "bom");
    router.refresh();
  }

  async function handleRelease(switchboardId: string) {
    setBusyId(switchboardId);
    const { error } = await supabase.rpc("unlock_switchboard", { p_switchboard_id: switchboardId });
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function handleClone(switchboardId: string) {
    setBusyId(switchboardId);
    const { error } = await supabase.rpc("clone_switchboard", { p_switchboard_id: switchboardId });
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function handleDelete(switchboardId: string, tag: string) {
    if (!confirm(`Delete switchboard "${tag}"? This removes its whole BOM and GA layout. This can't be undone.`)) return;
    setBusyId(switchboardId);
    const { error } = await supabase.from("switchboards").delete().eq("id", switchboardId);
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    onSwitchboardDeleted(switchboardId);
  }

  async function handleAddSwitchboard() {
    const nextNum = boards.length + 1;
    const { error } = await supabase.from("switchboards").insert({
      revision_id: revisionId,
      tag: `SB-${String(nextNum).padStart(2, "0")}`,
      title: `Board ${nextNum}`,
      sort_order: boards.length,
    });
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  // Optimistic, local-only update: reflects instantly in the table and
  // fires the write in the background. No router.refresh() here — this
  // runs on every field blur, and refreshing the whole page each time is
  // what produced the "Failed to fetch" errors.
  async function updateSwitchboardField(switchboardId: string, fieldPatch: Partial<Switchboard>) {
    setBoards((prev) =>
      prev.map((item) => (item.switchboard.id === switchboardId ? { ...item, switchboard: { ...item.switchboard, ...fieldPatch } } : item))
    );
    const { error } = await supabase.from("switchboards").update(fieldPatch).eq("id", switchboardId);
    if (error) alert(error.message);
  }

  function startRename(sb: Switchboard) {
    setRenamingId(sb.id);
    setRenameDraft(sb.title ?? "");
  }

  function commitRename(sb: Switchboard) {
    const next = renameDraft.trim() || null;
    setRenamingId(null);
    if (next === sb.title) return;
    updateSwitchboardField(sb.id, { title: next });
  }

  const currencyLabel = CURRENCIES.find((c) => c.code === form.currency)?.label ?? form.currency;

  const totalUnits = boards.reduce((s, b) => s + b.switchboard.qty, 0);
  const totalMfgCost = boards.reduce((s, b) => s + b.breakdown.mfgTotal * b.switchboard.qty, 0);
  const avgMarginPct = boards.length > 0 ? boards.reduce((s, b) => s + b.switchboard.profit_pct, 0) / boards.length : 0;
  const totalPriceSum = boards.reduce(
    (s, b) => s + b.breakdown.mfgTotal * (1 + b.switchboard.profit_pct / 100) * b.switchboard.qty,
    0
  );

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container-high bg-surface-container-lowest px-margin-lg py-space-lg">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-headline-lg text-on-surface">Project Costing</h1>
            <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">{project.code}</span>
          </div>
          <p className="mt-1 font-body-sm text-body-sm text-secondary">
            {boards.length} Switchboard{boards.length === 1 ? "" : "s"} · Currency: {currencyLabel} · Client: {customerLabel || "—"}
          </p>
        </div>
        <div className="flex items-center gap-space-sm">
          {!revisionArchived && justSaved && !dirty && <span className="font-body-sm text-body-sm text-tertiary">Saved</span>}
          {!revisionArchived && dirty && <span className="font-body-sm text-body-sm text-amber-600">Unsaved changes</span>}
          <button
            disabled
            title="Export coming soon"
            className="flex items-center gap-1 rounded bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
          >
            <Icon name="file_save" size={16} /> Export Project (PDF/XLSX)
          </button>
          {!revisionArchived && (
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="save" size={16} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-space-lg p-margin-lg">
        {/* Stage */}
        <div className="rounded-xl bg-surface-container-lowest p-space-lg shadow-sm">
          <div className="mb-space-md flex items-center justify-between">
            <h2 className="font-headline-md text-headline-md text-on-surface">Stage</h2>
            <span className="font-body-sm text-body-sm text-secondary">
              Current Stage: <span className="font-semibold text-on-surface">{form.stage.toUpperCase()}</span>
            </span>
          </div>
          <StageStepper value={form.stage} onChange={(s) => patch("stage", s)} disabled={revisionArchived} />
        </div>

        {/* Project Information */}
        <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
          <button
            onClick={() => setInfoCollapsed((v) => !v)}
            className="flex w-full items-center justify-between p-space-lg text-left"
          >
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="font-headline-md text-headline-md text-on-surface">Project Information</span>
              <span className="font-body-sm text-body-sm font-normal text-secondary">(Click to toggle)</span>
            </span>
            <span className="flex items-center gap-1 rounded bg-surface-container-low px-space-sm py-1 font-label-md text-label-md text-on-surface">
              <Icon name={infoCollapsed ? "expand_more" : "expand_less"} size={16} />
              {infoCollapsed ? "Expand" : "Collapse"}
            </span>
          </button>

          {!infoCollapsed && (
            <div className="space-y-space-lg border-t border-surface-container-high p-space-lg">
              <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Project Code">
                  <ReadOnlyValue value={project.code} mono />
                </Field>
                <Field label="Revision Number">
                  <ReadOnlyValue value={`Rev ${revision.revision_number}`} />
                </Field>
                <Field label="Revision Date">
                  <ReadOnlyValue value={formatDate(revision.created_at)} />
                </Field>
                <Field label="Created By">
                  <ReadOnlyValue value={createdByName || "—"} />
                </Field>

                <Field label="Project Name" className="sm:col-span-2">
                  <input
                    disabled={revisionArchived}
                    value={form.title}
                    onChange={(e) => patch("title", e.target.value)}
                    className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container-low"
                  />
                </Field>
                <Field label="Customer" className="sm:col-span-2">
                  {isAdmin && !revisionArchived ? (
                    <select
                      value={form.customer_id ?? ""}
                      onChange={(e) => {
                        const id = e.target.value || null;
                        patch("customer_id", id);
                        setCustomerLabel(customerOptions.find((o) => o.id === id)?.name ?? "");
                      }}
                      className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">No customer</option>
                      {customerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <ReadOnlyValue value={customerLabel || "—"} />
                  )}
                </Field>

                <Field label="Project Owner">
                  {revisionArchived ? (
                    <ReadOnlyValue value={ownerLabel || "—"} />
                  ) : (
                    <select
                      value={form.owner_id ?? ""}
                      onChange={(e) => {
                        const id = e.target.value || null;
                        patch("owner_id", id);
                        setOwnerLabel(allUsers.find((u) => u.id === id)?.full_name ?? null);
                      }}
                      className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">No owner</option>
                      {allUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email || "Unnamed user"}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="CRM Enquiry Number">
                  <input
                    disabled={revisionArchived}
                    value={form.crm_enquiry_number ?? ""}
                    onChange={(e) => patch("crm_enquiry_number", e.target.value || null)}
                    className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container-low"
                  />
                </Field>
                <Field label="Enquiry Date">
                  <input
                    type="date"
                    disabled={revisionArchived}
                    value={form.crm_enquiry_date ?? ""}
                    onChange={(e) => patch("crm_enquiry_date", e.target.value || null)}
                    className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container-low"
                  />
                </Field>
                <Field label="Site">
                  <select
                    disabled={revisionArchived}
                    value={form.site_country ?? ""}
                    onChange={(e) => patch("site_country", e.target.value || null)}
                    className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container-low"
                  >
                    <option value="">Select country...</option>
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Consultant" className="sm:col-span-2">
                  {revisionArchived ? (
                    <ReadOnlyValue value={consultantLabel || "—"} />
                  ) : (
                    <LookupSelect
                      table="consultants"
                      value={form.consultant_id}
                      onChange={(id, name) => {
                        patch("consultant_id", id);
                        setConsultantLabel(name);
                      }}
                      placeholder="Select or add consultant..."
                    />
                  )}
                </Field>
                <Field label="Sales Exec" className="sm:col-span-2">
                  {revisionArchived ? (
                    <ReadOnlyValue value={salesExecLabel || "—"} />
                  ) : (
                    <LookupSelect
                      table="sales_execs"
                      value={form.sales_exec_id}
                      onChange={(id, name) => {
                        patch("sales_exec_id", id);
                        setSalesExecLabel(name);
                      }}
                      placeholder="Select or add sales exec..."
                    />
                  )}
                </Field>

                <Field label="Currency" className="sm:col-span-2">
                  <select
                    disabled={revisionArchived}
                    value={form.currency}
                    onChange={(e) => patch("currency", e.target.value)}
                    className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container-low"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Exchange Rate" className="sm:col-span-2">
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    disabled={revisionArchived}
                    value={form.exchange_rate}
                    onChange={(e) => patch("exchange_rate", Number(e.target.value) || 0)}
                    className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container-low"
                  />
                </Field>
              </div>

              <div>
                <label className="mb-1 block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Project Scope &amp; Engineering Description
                </label>
                <textarea
                  disabled={revisionArchived}
                  value={form.notes ?? ""}
                  onChange={(e) => patch("notes", e.target.value || null)}
                  rows={3}
                  placeholder="Scope, site details, special requirements..."
                  className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-2 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container-low"
                />
              </div>
            </div>
          )}
        </div>

        {/* Switchboards */}
        <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
          <div className="flex items-center justify-between p-space-lg pb-space-md">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="font-headline-md text-headline-md text-on-surface">Switchboards</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{boards.length} Switchboards</span>
            </span>
            {!revisionArchived && (
              <button
                onClick={handleAddSwitchboard}
                className="flex items-center gap-1 rounded bg-primary px-space-md py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container"
              >
                <Icon name="add" size={15} /> Add Switchboard
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-surface-container-low font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-space-md py-space-sm">#</th>
                  <th className="px-space-md py-space-sm">Switchboard</th>
                  <th className="px-space-md py-space-sm">Type</th>
                  <th className="w-36 px-space-md py-space-sm">Std</th>
                  <th className="px-space-md py-space-sm text-right">Amps</th>
                  <th className="px-space-md py-space-sm">IP</th>
                  <th className="px-space-md py-space-sm text-right">kA</th>
                  <th className="px-space-md py-space-sm text-right">Qty</th>
                  <th className="px-space-md py-space-sm text-right">Unit Cost</th>
                  <th className="px-space-md py-space-sm text-right">Margin</th>
                  <th className="px-space-md py-space-sm text-right">Total Price</th>
                  <th className="px-space-md py-space-sm">Updated</th>
                  <th className="px-space-md py-space-sm">By</th>
                  <th className="px-space-md py-space-sm" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {boards.map((item, index) => {
                  const sb = item.switchboard;
                  const isLockedByMe = sb.locked_by === currentUserId;
                  const isLockedByOther = sb.locked_by !== null && !isLockedByMe;
                  const busy = busyId === sb.id;
                  const unitCost = item.breakdown.mfgTotal;
                  const margin = unitCost * (sb.profit_pct / 100);
                  const totalPrice = (unitCost + margin) * sb.qty;
                  const rowDisabled = revisionArchived || isLockedByOther;
                  const isRenaming = renamingId === sb.id;

                  return (
                    <tr key={sb.id} className="align-top transition-colors hover:bg-surface-container-low">
                      <td className="px-space-md py-space-md text-on-surface-variant">{index + 1}</td>
                      <td className="max-w-64 px-space-md py-space-md">
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={() => commitRename(sb)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(sb);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            placeholder="Switchboard name..."
                            className="w-full rounded border border-primary/40 px-1.5 py-1 font-headline-sm text-headline-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => onOpenSwitchboard(sb.id, "bom")}
                              className="text-left font-headline-sm text-headline-sm text-on-surface hover:text-primary hover:underline"
                            >
                              {sb.tag}
                              {sb.title ? `: ${sb.title}` : ""}
                            </button>
                            {!rowDisabled && (
                              <button
                                onClick={() => startRename(sb)}
                                title="Rename switchboard"
                                className="rounded p-0.5 text-secondary hover:bg-surface-container-high hover:text-on-surface"
                              >
                                <Icon name="edit" size={12} />
                              </button>
                            )}
                          </div>
                        )}
                        <input
                          disabled={rowDisabled}
                          defaultValue={sb.description ?? ""}
                          placeholder="Description..."
                          onBlur={(e) => {
                            if (e.target.value === (sb.description ?? "")) return;
                            updateSwitchboardField(sb.id, { description: e.target.value || null });
                          }}
                          className="mt-0.5 w-full rounded border border-transparent bg-transparent px-0 py-0.5 text-[11px] font-normal text-secondary focus:border-surface-container-high focus:bg-surface-container-lowest disabled:bg-transparent"
                        />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {isLockedByMe && (
                            <span className="flex items-center gap-1 rounded bg-tertiary-container/15 px-1.5 py-0.5 text-[10px] font-medium text-tertiary">
                              <Icon name="lock_open" size={11} /> Locked by you
                            </span>
                          )}
                          {isLockedByOther && (
                            <span className="flex items-center gap-1 rounded bg-secondary-container px-1.5 py-0.5 text-[10px] font-medium text-on-secondary-container">
                              <Icon name="lock" size={11} /> {item.lockedByName || "Locked"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="w-36 px-space-md py-space-md">
                        <LookupSelect
                          table="switchboard_types"
                          value={sb.switchboard_type_id}
                          disabled={rowDisabled}
                          options={typeOptions}
                          onOptionsChange={setTypeOptions}
                          onChange={(id) => updateSwitchboardField(sb.id, { switchboard_type_id: id })}
                          placeholder="Type..."
                        />
                      </td>
                      <td className="w-36 px-space-md py-space-md">
                        <select
                          disabled={rowDisabled}
                          value={sb.std ?? ""}
                          onChange={(e) => updateSwitchboardField(sb.id, { std: (e.target.value || null) as Switchboard["std"] })}
                          className="w-full min-w-[104px] rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-1 disabled:border-transparent disabled:bg-transparent"
                        >
                          <option value="">—</option>
                          {STD_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-space-md py-space-md text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          disabled={rowDisabled}
                          defaultValue={sb.amps ?? ""}
                          onBlur={(e) => {
                            const digits = e.target.value.replace(/[^0-9]/g, "");
                            e.target.value = digits;
                            const next = digits === "" ? null : Number(digits);
                            if (next === (sb.amps ?? null)) return;
                            updateSwitchboardField(sb.id, { amps: next });
                          }}
                          className="w-14 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-space-md py-space-md">
                        <select
                          disabled={rowDisabled}
                          value={sb.ip_rating ?? ""}
                          onChange={(e) => updateSwitchboardField(sb.id, { ip_rating: e.target.value || null })}
                          className="w-16 rounded border border-surface-container-high bg-surface-container-lowest px-1 py-0.5 disabled:border-transparent disabled:bg-transparent"
                        >
                          <option value="">—</option>
                          {IP_OPTIONS.map((ip) => (
                            <option key={ip} value={ip}>
                              IP{ip}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-space-md py-space-md text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          disabled={rowDisabled}
                          defaultValue={sb.ka ?? ""}
                          onBlur={(e) => {
                            const digits = e.target.value.replace(/[^0-9]/g, "");
                            e.target.value = digits;
                            const next = digits === "" ? null : Number(digits);
                            if (next === (sb.ka ?? null)) return;
                            updateSwitchboardField(sb.id, { ka: next });
                          }}
                          className="w-12 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-space-md py-space-md text-right">
                        <input
                          type="number"
                          min="1"
                          disabled={rowDisabled}
                          defaultValue={sb.qty}
                          onBlur={(e) => {
                            const next = Number(e.target.value) || 1;
                            if (next === sb.qty) return;
                            updateSwitchboardField(sb.id, { qty: next });
                          }}
                          className="w-14 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                        />
                      </td>
                      <td className="whitespace-nowrap px-space-md py-space-md text-right tabular-nums text-on-surface-variant">{money(unitCost)}</td>
                      <td className="whitespace-nowrap px-space-md py-space-md text-right tabular-nums text-tertiary">{money(margin)}</td>
                      <td className="whitespace-nowrap px-space-md py-space-md text-right tabular-nums font-semibold text-on-surface">
                        {money(totalPrice)}
                      </td>
                      <td className="whitespace-nowrap px-space-md py-space-md text-on-surface-variant">{formatDateTime(sb.updated_at)}</td>
                      <td className="whitespace-nowrap px-space-md py-space-md text-on-surface-variant">{item.updatedByName || "—"}</td>
                      <td className="px-space-md py-space-md">
                        <div className="flex items-center gap-1">
                          {!revisionArchived && !isLockedByOther && (
                            <button
                              onClick={() => handleLockAndOpen(sb.id, isLockedByMe)}
                              disabled={busy}
                              title={isLockedByMe ? "Continue editing" : "Lock & open"}
                              className="rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-50"
                            >
                              <Icon name="edit" size={15} />
                            </button>
                          )}
                          {!revisionArchived && isLockedByOther && isAdmin && (
                            <button
                              onClick={() => handleRelease(sb.id)}
                              disabled={busy}
                              title="Force unlock"
                              className="rounded p-1 text-secondary hover:bg-surface-container-high"
                            >
                              <Icon name="lock_open" size={15} />
                            </button>
                          )}
                          {isLockedByMe && !revisionArchived && (
                            <button
                              onClick={() => handleRelease(sb.id)}
                              disabled={busy}
                              title="Release lock"
                              className="rounded p-1 text-secondary hover:bg-surface-container-high"
                            >
                              <Icon name="lock_open" size={15} />
                            </button>
                          )}
                          {!revisionArchived && (
                            <button
                              onClick={() => handleClone(sb.id)}
                              disabled={busy}
                              title="Clone"
                              className="rounded p-1 text-secondary hover:bg-surface-container-high"
                            >
                              <Icon name="content_copy" size={15} />
                            </button>
                          )}
                          {!revisionArchived && !isLockedByOther && (
                            <button
                              onClick={() => handleDelete(sb.id, sb.tag)}
                              disabled={busy}
                              title="Delete"
                              className="rounded p-1 text-error hover:bg-error-container"
                            >
                              <Icon name="delete" size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {boards.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-space-md py-10 text-center text-secondary">
                      No switchboards yet. Add one to start building its BOM and GA.
                    </td>
                  </tr>
                )}
              </tbody>
              {boards.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-surface-container-high bg-surface-container-low font-semibold text-on-surface">
                    <td colSpan={8} className="px-space-md py-space-sm">
                      Total - {boards.length} Product{boards.length === 1 ? "" : "s"} / {totalUnits} unit{totalUnits === 1 ? "" : "s"}
                    </td>
                    <td className="whitespace-nowrap px-space-md py-space-sm text-right tabular-nums">{money(totalMfgCost)}</td>
                    <td className="whitespace-nowrap px-space-md py-space-sm text-right tabular-nums text-tertiary">{avgMarginPct.toFixed(2)}% avg</td>
                    <td className="whitespace-nowrap px-space-md py-space-sm text-right tabular-nums text-primary">{money(totalPriceSum)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</label>
      {children}
    </div>
  );
}

function ReadOnlyValue({ value, mono = false }: { value: string; mono?: boolean }) {
  return (
    <div className={`rounded border border-transparent bg-surface-container-low px-space-sm py-1.5 text-body-sm text-on-surface-variant ${mono ? "font-mono text-xs" : ""}`}>
      {value}
    </div>
  );
}
