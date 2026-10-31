"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RevisionControls } from "@/components/revision-controls";
import { ProjectDetailTab } from "@/components/project-detail-tab";
import { BomBuilder } from "@/components/bom-builder";
import { GaCanvas } from "@/components/ga-canvas";
import { CostingMatrix } from "@/components/costing-matrix";
import type { RevisionContext } from "@/lib/revision-context";
import type { ItemMaster } from "@/types/database";
import { useSwitchboardHeartbeat } from "@/lib/switchboard-presence";

export type Tab = "detail" | "bom" | "ga" | "costing";

const TABS: {
  id: Tab;
  label: string;
  needsSwitchboard: boolean;
}[] = [
  {
    id: "detail",
    label: "Project Details",
    needsSwitchboard: false,
  },
  {
    id: "costing",
    label: "Costing Summary",
    needsSwitchboard: false,
  },
  {
    id: "bom",
    label: "BOM Builder",
    needsSwitchboard: true,
  },
  { id: "ga", label: "GA Builder", needsSwitchboard: true },
];

export function RevisionWorkspace({
  ctx,
  currentUserId,
  isAdmin,
  allItems,
}: {
  ctx: RevisionContext;
  currentUserId: string;
  isAdmin: boolean;
  allItems: ItemMaster[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = (searchParams.get("tab") as Tab | null) ?? "detail";
  const initialSwitchboard = searchParams.get("sb");

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [selectedSwitchboardId, setSelectedSwitchboardId] = useState<
    string | null
  >(initialSwitchboard);
  useSwitchboardHeartbeat(selectedSwitchboardId);
  const [archived, setArchived] = useState(ctx.revision.archived);

  const {
    revision,
    project,
    customer,
    createdByName,
    consultantName,
    salesExecName,
    ownerName,
    siblingRevisions,
    switchboards,
    allUsers,
  } = ctx;

  function openSwitchboard(switchboardId: string, tab: Tab = "bom") {
    setSelectedSwitchboardId(switchboardId);
    setActiveTab(tab);
  }

  function handleSwitchboardDeleted(switchboardId: string) {
    if (selectedSwitchboardId === switchboardId) {
      setSelectedSwitchboardId(null);
      setActiveTab("detail");
    }
    router.refresh();
  }

  const selectedSwitchboard =
    switchboards.find((s) => s.switchboard.id === selectedSwitchboardId) ??
    null;

  return (
    <div className="flex h-[calc(100vh-52px)] flex-col overflow-hidden">
      {/* row2: subtabs, open switchboard, revision controls, last saved */}
      <div className="flex h-10 shrink-0 items-center gap-space-md overflow-x-auto border-b border-surface-container-high bg-surface-container-lowest px-space-lg">
        <nav className="flex h-full items-stretch gap-1">
          {TABS.map((t) => {
            const disabled = t.needsSwitchboard && !selectedSwitchboardId;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => !disabled && setActiveTab(t.id)}
                disabled={disabled}
                title={
                  disabled
                    ? "Select a switchboard from Project Details first"
                    : undefined
                }
                className={`whitespace-nowrap border-b-2 px-space-sm text-[13px] transition-colors ${
                  disabled
                    ? "cursor-not-allowed border-transparent text-on-surface-variant/50"
                    : active
                      ? "border-primary font-bold text-primary"
                      : "border-transparent text-secondary hover:text-on-surface"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
        {selectedSwitchboard && (
          <span
            className="truncate whitespace-nowrap text-[13px] font-bold text-on-surface"
            title="Open switchboard"
          >
            {selectedSwitchboard.switchboard.tag}
            {selectedSwitchboard.switchboard.title
              ? `: ${selectedSwitchboard.switchboard.title}`
              : ""}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-space-md">
          <RevisionControls
            revisionId={revision.id}
            initialArchived={revision.archived}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            createdBy={revision.created_by}
            revisionNumber={revision.revision_number}
            siblingRevisions={siblingRevisions}
            onStateChange={setArchived}
          />
          <span className="whitespace-nowrap text-[12px] text-secondary">
            Last saved:{" "}
            {new Date(revision.updated_at).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "detail" && (
          <ProjectDetailTab
            project={project}
            revision={revision}
            customer={customer}
            createdByName={createdByName}
            consultantName={consultantName}
            salesExecName={salesExecName}
            ownerName={ownerName}
            allUsers={allUsers}
            switchboards={switchboards}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            revisionId={revision.id}
            revisionArchived={archived}
            onOpenSwitchboard={openSwitchboard}
            onSwitchboardDeleted={handleSwitchboardDeleted}
          />
        )}

        {activeTab === "bom" && selectedSwitchboardId && (
          <BomBuilder
            key={selectedSwitchboardId}
            switchboardId={selectedSwitchboardId}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            revisionArchived={archived}
            allItems={allItems}
          />
        )}

        {activeTab === "ga" && selectedSwitchboardId && (
          <GaCanvas
            key={selectedSwitchboardId}
            switchboardId={selectedSwitchboardId}
            currentUserId={currentUserId}
            revisionArchived={archived}
          />
        )}

        {activeTab === "costing" && (
          <CostingMatrix
            revision={revision}
            project={project}
            customer={customer}
            columns={switchboards.map((s) => ({
              switchboard: s.switchboard,
              specSummary: s.specSummary,
              breakdown: s.breakdown,
            }))}
            archived={archived}
          />
        )}
      </div>
    </div>
  );
}
