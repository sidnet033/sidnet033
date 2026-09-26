"use client";

import { Icon } from "@/components/icon";
import type { ProjectStage } from "@/types/database";

const MAIN_FLOW: { id: ProjectStage; label: string }[] = [
  { id: "new", label: "1. New" },
  { id: "wip", label: "2. WIP" },
  { id: "quoted", label: "3. Quoted" },
  { id: "finalization", label: "4. Finalization" },
];

const OUTCOMES: { id: ProjectStage; label: string; activeClass: string }[] = [
  { id: "won", label: "Won", activeClass: "text-emerald-600" },
  { id: "lost", label: "Lost", activeClass: "text-error" },
  { id: "hold", label: "Hold", activeClass: "text-on-surface-variant" },
  { id: "budgetary", label: "Budgetary", activeClass: "text-on-surface-variant" },
];

const MAIN_ORDER: ProjectStage[] = ["new", "wip", "quoted", "finalization", "won"];

export function StageStepper({
  value,
  onChange,
  disabled,
}: {
  value: ProjectStage;
  onChange: (stage: ProjectStage) => void;
  disabled?: boolean;
}) {
  const isSideStage = value === "hold" || value === "budgetary";
  const mainIndex = MAIN_ORDER.indexOf(isSideStage ? "new" : value === "lost" ? "won" : value);

  return (
    <div className="flex flex-col gap-space-md lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-1">
        {MAIN_FLOW.map((s, i) => {
          const active = !isSideStage && value !== "won" && value !== "lost" && i <= mainIndex;
          const isCurrent = value === s.id;
          return (
            <div key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(s.id)}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 font-label-md text-label-md font-semibold uppercase tracking-wide transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  isCurrent
                    ? "bg-primary text-on-primary"
                    : active
                      ? "bg-primary/10 text-primary"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                {isCurrent ? <Icon name="check_circle" size={14} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                {s.label}
              </button>
              {i < MAIN_FLOW.length - 1 && <Icon name="chevron_right" size={16} className="text-on-surface-variant" />}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-space-sm">
        <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Outcomes:</span>
        {OUTCOMES.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={`font-label-md text-label-md font-bold uppercase tracking-wide transition-colors cursor-pointer disabled:cursor-not-allowed ${
              value === s.id ? s.activeClass : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
