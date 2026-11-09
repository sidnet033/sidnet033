"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import {
  loadProjectOverrides,
  loadRateMaster,
  type EnclosureRateRow,
  type RateKey,
} from "@/lib/enclosure-rates";

// Enclosure Rates Master as a popup.
//  - projectId given: the project's rates. Each rate shows the app rate; type
//    a value to override it for this project, clear it to go back to the app
//    rate. Saving recalculates this project's ArTuK part costs (only when a
//    rate actually changed).
//  - no projectId: the app-level master (admins only can save). Saving
//    recalculates every sub-part, Item Master and projects with overrides.
export function EnclosureRatesDialog({
  projectId,
  canEdit,
  onClose,
  onSaved,
}: {
  projectId?: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [master, setMaster] = useState<EnclosureRateRow[]>([]);
  const [saved, setSaved] = useState<Partial<Record<RateKey, number>>>({});
  const [draft, setDraft] = useState<Partial<Record<RateKey, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await loadRateMaster(supabase);
      const o = projectId
        ? await loadProjectOverrides(supabase, projectId)
        : {};
      if (cancelled) return;
      setMaster(m);
      if (projectId) {
        setSaved(o);
        setDraft(
          Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])),
        );
      } else {
        setDraft(Object.fromEntries(m.map((r) => [r.key, String(r.rate)])));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, projectId]);

  const parsed = (k: RateKey): number | null | "bad" => {
    const t = (draft[k] ?? "").trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : "bad";
  };
  const changes = master.filter((r) => {
    const v = parsed(r.key);
    if (v === "bad") return false;
    return projectId
      ? (v ?? null) !== (saved[r.key] ?? null)
      : v != null && v !== r.rate;
  });
  const invalid = master.some(
    (r) => parsed(r.key) === "bad" || (!projectId && parsed(r.key) == null),
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (projectId) {
        const upserts = changes
          .filter((r) => parsed(r.key) != null)
          .map((r) => ({
            project_id: projectId,
            key: r.key,
            rate: parsed(r.key) as number,
            updated_at: new Date().toISOString(),
          }));
        const deletes = changes
          .filter((r) => parsed(r.key) == null)
          .map((r) => r.key);
        if (upserts.length) {
          const { error: e } = await supabase
            .from("project_enclosure_rates")
            .upsert(upserts);
          if (e) throw e;
        }
        if (deletes.length) {
          const { error: e } = await supabase
            .from("project_enclosure_rates")
            .delete()
            .eq("project_id", projectId)
            .in("key", deletes);
          if (e) throw e;
        }
      } else {
        for (const r of changes) {
          const { error: e } = await supabase
            .from("enclosure_rates")
            .update({
              rate: parsed(r.key) as number,
              updated_at: new Date().toISOString(),
            })
            .eq("key", r.key);
          if (e) throw e;
        }
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rates.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        projectId ? "Enclosure rates — this project" : "Enclosure Rates Master"
      }
      onClose={onClose}
      width="max-w-xl"
    >
      <div className="space-y-3 text-sm">
        <p className="text-[12px] text-secondary">
          {projectId
            ? "Leave a rate blank to use the app rate. Changing any rate recalculates this project's ArTuK enclosure part costs."
            : "App-level rates used by every project that hasn't set its own. Saving recalculates all ArTuK sub-part and part costs."}
        </p>
        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="text-left text-[11px] uppercase tracking-wider text-secondary">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1">Unit</th>
                {projectId && <th className="py-1 text-right">App rate</th>}
                <th className="py-1 text-center">
                  {projectId ? "Project rate" : "Rate"}
                </th>
              </tr>
            </thead>
            <tbody>
              {master.map((r) => {
                const v = parsed(r.key);
                const overridden = projectId && v != null && v !== "bad";
                return (
                  <tr key={r.key} className="border-t border-surface-container">
                    <td className="py-1 font-bold text-on-surface-variant">
                      {r.label}
                    </td>
                    <td className="py-1 text-secondary">{r.unit}</td>
                    {projectId && (
                      <td className="py-1 text-right text-secondary">
                        {r.rate}
                      </td>
                    )}
                    <td className="py-1 text-center">
                      <input
                        inputMode="decimal"
                        disabled={!canEdit}
                        value={draft[r.key] ?? ""}
                        placeholder={projectId ? String(r.rate) : ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [r.key]: e.target.value }))
                        }
                        className={`w-28 rounded border px-2 py-1 text-center disabled:bg-surface-container-low ${
                          v === "bad"
                            ? "border-error"
                            : overridden
                              ? "border-primary font-bold text-primary"
                              : "border-surface-container-high"
                        } bg-surface-container-lowest`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {error && <p className="text-[12px] text-error">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-surface-container pt-3">
          <button onClick={onClose} className="btn btn-outline btn-sm">
            {canEdit ? "Cancel" : "Close"}
          </button>
          {canEdit && (
            <button
              onClick={save}
              disabled={busy || loading || invalid || changes.length === 0}
              className="btn btn-primary btn-sm"
            >
              {busy
                ? "Saving…"
                : changes.length
                  ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`
                  : "No changes"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
