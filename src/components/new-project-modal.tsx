"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import type { Customer } from "@/types/database";

export function NewProjectModal({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [title, setTitle] = useState("");
  const [revisionName, setRevisionName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creatingNewCustomer = customerId === "__new__";

  function reset() {
    setCustomerId("");
    setNewCustomerName("");
    setTitle("");
    setRevisionName("");
    setNotes("");
    setError(null);
    setOpen(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give the project a title.");
      return;
    }
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let finalCustomerId: string | null = customerId || null;
    let customerName = customers.find((c) => c.id === customerId)?.name ?? null;

    if (creatingNewCustomer) {
      if (!newCustomerName.trim()) {
        setError("Give the new customer a name.");
        setSaving(false);
        return;
      }
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .insert({ name: newCustomerName.trim() })
        .select("id, name")
        .single();
      if (customerError || !customer) {
        setError(customerError?.message ?? "Could not create customer.");
        setSaving(false);
        return;
      }
      finalCustomerId = customer.id;
      customerName = customer.name;
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ customer_id: finalCustomerId, title: title.trim(), notes: notes.trim() || null, created_by: user?.id })
      .select("id")
      .single();
    if (projectError || !project) {
      setError(projectError?.message ?? "Could not create project.");
      setSaving(false);
      return;
    }

    const { data: revision, error: revisionError } = await supabase
      .from("revisions")
      .insert({ project_id: project.id, name: revisionName.trim() || title.trim(), customer_name: customerName, created_by: user?.id })
      .select("id")
      .single();
    if (revisionError || !revision) {
      setError(revisionError?.message ?? "Could not create the first revision.");
      setSaving(false);
      return;
    }

    const { error: switchboardError } = await supabase
      .from("switchboards")
      .insert({ revision_id: revision.id, tag: "SB-01", title: "Board 1", sort_order: 0 });
    setSaving(false);

    if (switchboardError) {
      setError(switchboardError.message);
      return;
    }

    router.push(`/revisions/${revision.id}`);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-space-xs rounded-lg bg-primary px-space-md font-body-md text-body-md font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-container"
      >
        <Icon name="add_circle" size={18} />
        <span>+ New Project</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-space-md backdrop-blur-sm">
          <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl">
            <div className="flex items-center justify-between bg-surface-container-low p-space-lg">
              <div className="flex items-center gap-space-sm">
                <div className="flex items-center justify-center rounded-lg bg-primary p-space-xs text-on-primary">
                  <Icon name="post_add" size={20} />
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface">Create / Revise Project</h3>
              </div>
              <button onClick={reset} className="rounded-lg p-space-xs text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">
                <Icon name="close" size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="flex flex-col gap-space-md p-space-lg">
              <div className="flex flex-col gap-space-2xs">
                <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-secondary">Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="h-9 w-full rounded bg-surface px-space-sm font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">No customer yet</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new__">+ Add New Customer Account...</option>
                </select>
                {creatingNewCustomer && (
                  <input
                    autoFocus
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="New customer name"
                    className="mt-space-2xs h-9 w-full rounded bg-surface px-space-sm font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-3">
                <div className="flex flex-col gap-space-2xs">
                  <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-secondary">Project Code</label>
                  <input
                    readOnly
                    value="Auto-generated"
                    className="h-9 w-full rounded bg-surface-container-high px-space-sm font-telemetry-md text-telemetry-md text-on-surface-variant focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-space-2xs sm:col-span-2">
                  <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-secondary">Project Title</label>
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Mount Sinai Tower B Main Switchboard Retrofit"
                    className="h-9 w-full rounded bg-surface px-space-sm font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-space-2xs">
                <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-secondary">Revision Name</label>
                <input
                  value={revisionName}
                  onChange={(e) => setRevisionName(e.target.value)}
                  placeholder={title || "Rev 01 (Base Tender Scope)"}
                  className="h-9 w-full rounded bg-surface px-space-sm font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-space-xs rounded-lg bg-surface-container-low p-space-sm">
                <span className="font-label-sm text-label-sm font-bold uppercase tracking-wider text-primary">About the Project</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Enter project notes, specification requirements, etc"
                  className="w-full rounded bg-surface p-2 font-body-sm text-body-sm text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {error && <p className="font-body-sm text-body-sm text-error">{error}</p>}

              <div className="mt-space-2xs flex items-center justify-end gap-space-sm pt-space-xs">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg bg-surface-container px-space-md py-space-xs font-body-md text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-space-2xs rounded-lg bg-primary px-space-md py-space-xs font-body-md text-body-md font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-container disabled:opacity-50"
                >
                  <Icon name="add_circle" size={16} />
                  {saving ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
