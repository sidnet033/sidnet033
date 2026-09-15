"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/types/database";

export function NewProjectModal({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creatingNewCustomer = customerId === "__new__";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
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
      .insert({ customer_id: finalCustomerId, title: title.trim(), created_by: user?.id })
      .select("id")
      .single();
    if (projectError || !project) {
      setError(projectError?.message ?? "Could not create project.");
      setSaving(false);
      return;
    }

    const { data: revision, error: revisionError } = await supabase
      .from("revisions")
      .insert({ project_id: project.id, name: title.trim(), customer_name: customerName, created_by: user?.id })
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
      >
        + New project
      </button>
    );
  }

  return (
    <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Customer</label>
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">No customer yet</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">+ Add new customer...</option>
        </select>
      </div>
      {creatingNewCustomer && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">New customer name</label>
          <input
            value={newCustomerName}
            onChange={(e) => setNewCustomerName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            placeholder="Customer name"
          />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Project title</label>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="e.g. New Wing Expansion"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? "Creating..." : "Create"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
