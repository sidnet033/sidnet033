"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { LookupSelect } from "@/components/lookup-select";
import { StageStepper } from "@/components/stage-stepper";
import { COUNTRIES } from "@/lib/countries";
import type { SwitchboardListItem } from "@/lib/revision-context";
import type { Customer, Project, ProjectStage, Revision, Switchboard } from "@/types/database";
import type { Tab } from "@/components/revision-workspace";

const STD_OPTIONS = ["ArTuK", "61439", "60439"] as const;
const IP_OPTIONS = ["42", "52", "54", "55", "63"];

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

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
  };
}

export function ProjectDetailTab({
  project,
  revision,
  customer,
  createdByName,
  consultantName,
  salesExecName,
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
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(savedSnapshot);

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

  return (
    <div className="max-w-6xl space-y-6 px-8 py-6">
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-900">Project Details</h2>
          {!revisionArchived && (
            <div className="flex items-center gap-2">
              {justSaved && !dirty && <span className="text-xs text-emerald-600">Saved</span>}
              {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Project Code">
            <ReadOnlyValue value={project.code} mono />
          </Field>
          <Field label="Revision Number">
            <ReadOnlyValue value={`Rev ${revision.revision_number}`} />
          </Field>
          <Field label="Revision Date">
            <ReadOnlyValue value={formatDate(revision.created_at)} />
          </Field>

          <Field label="Project Name">
            <input
              disabled={revisionArchived}
              value={form.title}
              onChange={(e) => patch("title", e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            />
          </Field>
          <Field label="Customer">
            {isAdmin && !revisionArchived ? (
              <select
                value={form.customer_id ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  patch("customer_id", id);
                  setCustomerLabel(customerOptions.find((o) => o.id === id)?.name ?? "");
                }}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
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
          <Field label="Created By">
            <ReadOnlyValue value={createdByName || "—"} />
          </Field>

          <Field label="CRM Enquiry Number">
            <input
              disabled={revisionArchived}
              value={form.crm_enquiry_number ?? ""}
              onChange={(e) => patch("crm_enquiry_number", e.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            />
          </Field>
          <Field label="CRM Enquiry Date">
            <input
              type="date"
              disabled={revisionArchived}
              value={form.crm_enquiry_date ?? ""}
              onChange={(e) => patch("crm_enquiry_date", e.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            />
          </Field>
          <Field label="Site Country">
            <select
              disabled={revisionArchived}
              value={form.site_country ?? ""}
              onChange={(e) => patch("site_country", e.target.value || null)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            >
              <option value="">Select country...</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Consultant">
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
          <Field label="Sales Exec">
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
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-600">Project Description</label>
          <textarea
            disabled={revisionArchived}
            value={form.notes ?? ""}
            onChange={(e) => patch("notes", e.target.value || null)}
            rows={3}
            placeholder="Scope, site details, special requirements..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50"
          />
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Stage</label>
          <StageStepper value={form.stage} onChange={(s) => patch("stage", s)} disabled={revisionArchived} />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-900">Switchboards</h2>
          {!revisionArchived && (
            <button
              onClick={handleAddSwitchboard}
              className="flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-500/60 hover:text-brand-600"
            >
              <Icon name="add" size={14} /> Add switchboard
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Switchboard</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Std</th>
                <th className="px-2 py-2 text-right">Amps</th>
                <th className="px-2 py-2">IP</th>
                <th className="px-2 py-2 text-right">kA</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Unit Cost</th>
                <th className="px-2 py-2 text-right">Margin</th>
                <th className="px-2 py-2 text-right">Total Price</th>
                <th className="px-2 py-2">Last Updated</th>
                <th className="px-2 py-2">Updated By</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {boards.map((item, index) => {
                const sb = item.switchboard;
                const isLockedByMe = sb.locked_by === currentUserId;
                const isLockedByOther = sb.locked_by !== null && !isLockedByMe;
                const busy = busyId === sb.id;
                const unitCost = item.breakdown.mfgTotal;
                const margin = unitCost * (sb.profit_pct / 100);
                const totalPrice = (unitCost + margin) * sb.qty;
                const rowDisabled = revisionArchived || isLockedByOther;

                return (
                  <tr key={sb.id} className="border-t border-slate-100 align-top hover:bg-slate-50/50">
                    <td className="px-2 py-2 text-slate-400">{index + 1}</td>
                    <td className="max-w-64 px-2 py-2">
                      <button
                        onClick={() => onOpenSwitchboard(sb.id, "bom")}
                        className="text-left font-semibold text-slate-900 hover:text-brand-600 hover:underline"
                      >
                        {sb.tag}
                        {sb.title ? `: ${sb.title}` : ""}
                      </button>
                      <input
                        disabled={rowDisabled}
                        defaultValue={sb.description ?? ""}
                        placeholder="Description..."
                        onBlur={(e) => {
                          if (e.target.value === (sb.description ?? "")) return;
                          updateSwitchboardField(sb.id, { description: e.target.value || null });
                        }}
                        className="mt-0.5 w-full rounded border border-transparent bg-transparent px-0 py-0.5 text-[11px] font-normal text-slate-400 focus:border-slate-200 focus:bg-white disabled:bg-transparent"
                      />
                      <div className="mt-1 flex flex-wrap gap-1">
                        {isLockedByMe && (
                          <span className="flex items-center gap-1 rounded border border-emerald-200/60 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                            <Icon name="lock_open" size={11} /> Locked by you
                          </span>
                        )}
                        {isLockedByOther && (
                          <span className="flex items-center gap-1 rounded border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            <Icon name="lock" size={11} /> {item.lockedByName || "Locked"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="w-36 px-2 py-2">
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
                    <td className="w-24 px-2 py-2">
                      <select
                        disabled={rowDisabled}
                        value={sb.std ?? ""}
                        onChange={(e) => updateSwitchboardField(sb.id, { std: (e.target.value || null) as Switchboard["std"] })}
                        className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 disabled:border-transparent disabled:bg-transparent"
                      >
                        <option value="">—</option>
                        {STD_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-right">
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
                        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        disabled={rowDisabled}
                        value={sb.ip_rating ?? ""}
                        onChange={(e) => updateSwitchboardField(sb.id, { ip_rating: e.target.value || null })}
                        className="w-16 rounded border border-slate-200 bg-white px-1 py-0.5 disabled:border-transparent disabled:bg-transparent"
                      >
                        <option value="">—</option>
                        {IP_OPTIONS.map((ip) => (
                          <option key={ip} value={ip}>
                            IP{ip}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-right">
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
                        className="w-12 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
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
                        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">{money(unitCost)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">{money(margin)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums font-semibold text-slate-900">
                      {money(totalPrice)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-500">{formatDateTime(sb.updated_at)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-500">{item.updatedByName || "—"}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        {!revisionArchived && !isLockedByOther && (
                          <button
                            onClick={() => handleLockAndOpen(sb.id, isLockedByMe)}
                            disabled={busy}
                            title={isLockedByMe ? "Continue editing" : "Lock & open"}
                            className="rounded p-1 text-brand-600 hover:bg-brand-50 disabled:opacity-50"
                          >
                            <Icon name="edit" size={15} />
                          </button>
                        )}
                        {!revisionArchived && isLockedByOther && isAdmin && (
                          <button
                            onClick={() => handleRelease(sb.id)}
                            disabled={busy}
                            title="Force unlock"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <Icon name="lock_open" size={15} />
                          </button>
                        )}
                        {isLockedByMe && !revisionArchived && (
                          <button
                            onClick={() => handleRelease(sb.id)}
                            disabled={busy}
                            title="Release lock"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <Icon name="lock_open" size={15} />
                          </button>
                        )}
                        {!revisionArchived && (
                          <button
                            onClick={() => handleClone(sb.id)}
                            disabled={busy}
                            title="Clone"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <Icon name="content_copy" size={15} />
                          </button>
                        )}
                        {!revisionArchived && !isLockedByOther && (
                          <button
                            onClick={() => handleDelete(sb.id, sb.tag)}
                            disabled={busy}
                            title="Delete"
                            className="rounded p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
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
                  <td colSpan={14} className="px-3 py-10 text-center text-slate-400">
                    No switchboards yet. Add one to start building its BOM and GA.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}

function ReadOnlyValue({ value, mono = false }: { value: string; mono?: boolean }) {
  return (
    <div className={`rounded-md border border-transparent bg-slate-50 px-2.5 py-1.5 text-sm text-slate-600 ${mono ? "font-mono text-xs" : ""}`}>
      {value}
    </div>
  );
}
