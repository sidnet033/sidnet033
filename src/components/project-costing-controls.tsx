"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { MarginEditor } from "@/components/margin-editor";
import { ProjectLockControls, type LockState } from "@/components/project-lock-controls";
import type { SiblingRevision } from "@/app/(app)/projects/[id]/ga/page";
import type { Project } from "@/types/database";

export function ProjectCostingControls({
  project,
  totalCost,
  currentUserId,
  currentUserName,
  isAdmin,
  lockedByName,
  siblingRevisions,
}: {
  project: Project;
  totalCost: number;
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  lockedByName: string | null;
  siblingRevisions: SiblingRevision[];
}) {
  const [lockState, setLockState] = useState<LockState>({
    locked_by: project.locked_by,
    archived: project.archived,
  });
  const readOnly = lockState.archived || (lockState.locked_by !== null && lockState.locked_by !== currentUserId);

  return (
    <div className="space-y-3">
      <ProjectLockControls
        projectId={project.id}
        initialLockedBy={project.locked_by}
        initialLockedByName={lockedByName}
        initialArchived={project.archived}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        isAdmin={isAdmin}
        createdBy={project.created_by}
        revisionNumber={project.revision_number}
        siblingRevisions={siblingRevisions}
        onStateChange={setLockState}
      />
      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <Icon name="visibility" size={15} />
          {lockState.archived
            ? "This project is archived — read only."
            : "Locked by another user — margin editing is off until it's released."}
        </div>
      )}
      <MarginEditor project={project} totalCost={totalCost} readOnly={readOnly} />
    </div>
  );
}
