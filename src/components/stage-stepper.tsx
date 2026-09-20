"use client";

import { Icon } from "@/components/icon";
import type { ProjectStage } from "@/types/database";

const MAIN_FLOW: { id: ProjectStage; label: string }[] = [
  { id: "new", label: "New" },
  { id: "wip", label: "WIP" },
  { id: "quoted", label: "Quoted" },
  { id: "finalization", label: "Finalization" },
];

const OUTCOMES: { id: ProjectStage; label: string }[] = [
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const SIDE_STAGES: { id: ProjectStage; label: string }[] = [
  { id: "hold", label: "Hold" },
  { id: "budgetary", label: "Budgetary" },
];

const MAIN_ORDER: ProjectStage[] = ["new", "wip", "quoted", "finalization", "won"];

function stageColor(stage: ProjectStage, active: boolean) {
  if (!active) return "border-surface-container-high bg-surface-container-lowest text-secondary hover:border-surface-container-high";
  if (stage === "won") return "border-tertiary bg-tertiary text-white";
  if (stage === "lost") return "border-error bg-error text-white";
  if (stage === "hold") return "border-amber-500 bg-amber-500 text-white";
  if (stage === "budgetary") return "border-secondary bg-secondary text-white";
  return "border-primary bg-primary text-white";
}

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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {MAIN_FLOW.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(s.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${stageColor(
                s.id,
                !isSideStage && i <= mainIndex
              )}`}
            >
              {s.label}
            </button>
            <Icon name="arrow_forward" size={14} className="text-on-surface-variant" />
          </div>
        ))}
        {OUTCOMES.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${stageColor(
              s.id,
              value === s.id
            )}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-on-surface-variant">Or move to:</span>
        {SIDE_STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${stageColor(
              s.id,
              value === s.id
            )}`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
