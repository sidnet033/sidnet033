"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { LookupSelect } from "@/components/lookup-select";
import { StageStepper } from "@/components/stage-stepper";
import { COUNTRIES } from "@/lib/countries";
import type { SwitchboardListItem } from "@/lib/revision-context";
import type { Customer, Project, ProjectStage, Revision } from "@/types/database";
import type { Tab } from "@/components/revision-workspace";

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
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

  const [title, setTitle] = useState(project.title);
  const [notes, setNotes] = useState(project.notes ?? "");
  const [crmNumber, setCrmNumber] = useState(project.crm_enquiry_number ?? "");
  const [crmDate, setCrmDate] = useState(project.crm_enquiry_date ?? "");
  const [siteCountry, setSiteCountry] = useState(project.site_country ?? "");
  const [consultantId, setConsultantId] = useState(project.consultant_id);
  const [salesExecId, setSalesExecId] = useState(project.sales_exec_id);
  const [stage, setStage] = useState<ProjectStage>(project.stage);
  const [customerId, setCustomerId] = useState(project.customer_id);
  const [customerName, setCustomerName] = useState(customer?.name ?? "");
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);

  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function saveProjectField(field: keyof Project, value: string | null) {
    await supabase.from("projects").update({ [field]: value }).eq("id", project.id);
  }

  async function handleStageChange(next: ProjectStage) {
    setStage(next);
    await supabase.from("projects").update({ stage: next }).eq("id", project.id);
  }

  async function handleCustomerChange(id: string) {
    const c = customerOptions.find((o) => o.id === id);
    setCustomerId(id || null);
    setCustomerName(c?.name ?? "");
    await supabase.from("projects").update({ customer_id: id || null }).eq("id", project.id);
  }

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
    const nextNum = switchboards.length + 1;
    const { error } = await supabase.from("switchboards").insert({
      revision_id: revisionId,
      tag: `SB-${String(nextNum).padStart(2, "0")}`,
      title: `Board ${nextNum}`,
      sort_order: switchboards.length,
    });
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  async function updateSwitchboardField(switchboardId: string, patch: Record<string, string | number | null>) {
    const { error } = await supabase.from("switchboards").update(patch).eq("id", switchboardId);
    if (error) alert(error.message);
    router.refresh();
  }

  return (
    <div className="max-w-6xl space-y-6 px-8 py-6">
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-900">Project Details</h2>

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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => saveProjectField("title", title)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            />
          </Field>
          <Field label="Customer">
            {isAdmin && !revisionArchived ? (
              <select
                value={customerId ?? ""}
                onChange={(e) => handleCustomerChange(e.target.value)}
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
              <ReadOnlyValue value={customerName || "—"} />
            )}
          </Field>
          <Field label="Created By">
            <ReadOnlyValue value={createdByName || "—"} />
          </Field>

          <Field label="CRM Enquiry Number">
            <input
              disabled={revisionArchived}
              value={crmNumber}
              onChange={(e) => setCrmNumber(e.target.value)}
              onBlur={() => saveProjectField("crm_enquiry_number", crmNumber || null)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            />
          </Field>
          <Field label="CRM Enquiry Date">
            <input
              type="date"
              disabled={revisionArchived}
              value={crmDate}
              onChange={(e) => setCrmDate(e.target.value)}
              onBlur={() => saveProjectField("crm_enquiry_date", crmDate || null)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            />
          </Field>
          <Field label="Site Country">
            <select
              disabled={revisionArchived}
              value={siteCountry}
              onChange={(e) => {
                setSiteCountry(e.target.value);
                saveProjectField("site_country", e.target.value || null);
              }}
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
              <ReadOnlyValue value={consultantName || "—"} />
            ) : (
              <LookupSelect
                table="consultants"
                value={consultantId}
                onChange={(id) => {
                  setConsultantId(id);
                  saveProjectField("consultant_id", id);
                }}
                placeholder="Select or add consultant..."
              />
            )}
          </Field>
          <Field label="Sales Exec">
            {revisionArchived ? (
              <ReadOnlyValue value={salesExecName || "—"} />
            ) : (
              <LookupSelect
                table="sales_execs"
                value={salesExecId}
                onChange={(id) => {
                  setSalesExecId(id);
                  saveProjectField("sales_exec_id", id);
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => saveProjectField("notes", notes || null)}
            rows={3}
            placeholder="Scope, site details, special requirements..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50"
          />
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Stage</label>
          <StageStepper value={stage} onChange={handleStageChange} disabled={revisionArchived} />
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
              {switchboards.map((item, index) => {
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
                        onBlur={(e) => updateSwitchboardField(sb.id, { description: e.target.value || null })}
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
                    <td className="w-40 px-2 py-2">
                      <LookupSelect
                        table="switchboard_types"
                        value={sb.switchboard_type_id}
                        disabled={rowDisabled}
                        onChange={(id) => updateSwitchboardField(sb.id, { switchboard_type_id: id })}
                        placeholder="Type..."
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        disabled={rowDisabled}
                        defaultValue={sb.amps ?? ""}
                        onBlur={(e) =>
                          updateSwitchboardField(sb.id, { amps: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        disabled={rowDisabled}
                        defaultValue={sb.ip_rating ?? ""}
                        placeholder="IP54"
                        onBlur={(e) => updateSwitchboardField(sb.id, { ip_rating: e.target.value || null })}
                        className="w-16 rounded border border-slate-200 px-1 py-0.5 disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        disabled={rowDisabled}
                        defaultValue={sb.ka ?? ""}
                        onBlur={(e) =>
                          updateSwitchboardField(sb.id, { ka: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min="1"
                        disabled={rowDisabled}
                        defaultValue={sb.qty}
                        onBlur={(e) => updateSwitchboardField(sb.id, { qty: Number(e.target.value) || 1 })}
                        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">{money(unitCost)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">{money(margin)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums font-semibold text-slate-900">
                      {money(totalPrice)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-500">{formatDate(sb.updated_at)}</td>
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
              {switchboards.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-slate-400">
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
