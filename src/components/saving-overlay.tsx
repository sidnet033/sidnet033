import { Icon } from "@/components/icon";

// Global "saving in progress" modal -- pass the same `saving` boolean a save
// handler already flips true/false around its await, and this shows/hides
// itself in lockstep, closing automatically the instant saving goes false.
export function SavingOverlay({ show, label = "Saving..." }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-inverse-surface/40">
      <div className="flex items-center gap-3 rounded-lg bg-surface-container-lowest px-6 py-4 shadow-lg">
        <Icon name="progress_activity" size={20} className="animate-spin text-primary" />
        <span className="text-sm font-medium text-on-surface">{label}</span>
      </div>
    </div>
  );
}
