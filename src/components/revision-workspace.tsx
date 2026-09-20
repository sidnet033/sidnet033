"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icon";
import { RevisionControls } from "@/components/revision-controls";
import { ProjectDetailTab } from "@/components/project-detail-tab";
import { BomBuilder } from "@/components/bom-builder";
import { GaCanvas } from "@/components/ga-canvas";
import { CostingMatrix } from "@/components/costing-matrix";
import type { RevisionContext } from "@/lib/revision-context";
import type { ItemMaster } from "@/types/database";

export type Tab = "detail" | "bom" | "ga" | "costing";

const TABS: { id: Tab; label: string; icon: string; needsSwitchboard: boolean }[] = [
  { id: "detail", label: "Project Details", icon: "info", needsSwitchboard: false },
  { id: "costing", label: "Costing Summary", icon: "table_chart", needsSwitchboard: false },
  { id: "bom", label: "BOM Builder", icon: "description", needsSwitchboard: true },
  { id: "ga", label: "GA Builder", icon: "tune", needsSwitchboard: true },
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
  const [selectedSwitchboardId, setSelectedSwitchboardId] = useState<string | null>(initialSwitchboard);
  const [archived, setArchived] = useState(ctx.revision.archived);

  const { revision, project, customer, createdByName, consultantName, salesExecName, ownerName, siblingRevisions, switchboards, allUsers } = ctx;

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

  const selectedSwitchboard = switchboards.find((s) => s.switchboard.id === selectedSwitchboardId) ?? null;
  const onSwitchboardTab = TABS.find((t) => t.id === activeTab)?.needsSwitchboard ?? false;

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">
      <div className="space-y-space-md border-b border-surface-container-high bg-surface-container-lowest px-space-lg py-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex flex-wrap items-center gap-space-xs font-body-sm text-body-sm text-secondary">
            <Link href="/" className="hover:text-primary hover:underline">
              Projects
            </Link>
            <Icon name="chevron_right" size={14} />
            <span className="text-on-surface">
              {project.code}
              {customer ? ` (${customer.name})` : ""}
            </span>
            <Icon name="chevron_right" size={14} />
            <span className="rounded bg-surface-container-low px-1.5 py-0.5 font-mono text-[11px] font-semibold text-on-surface">
              REV {revision.revision_number}
            </span>
            {selectedSwitchboard && onSwitchboardTab && (
              <>
                <Icon name="chevron_right" size={14} />
                <span className="font-medium text-on-surface">{selectedSwitchboard.switchboard.tag}</span>
              </>
            )}
          </div>
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
        </div>

        <nav className="flex items-center gap-space-xs overflow-x-auto rounded-xl bg-surface-container-low px-space-xs">
          {TABS.map((t) => {
            const disabled = t.needsSwitchboard && !selectedSwitchboardId;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => !disabled && setActiveTab(t.id)}
                disabled={disabled}
                title={disabled ? "Select a switchboard from Project Details first" : undefined}
                className={`flex items-center gap-space-xs py-space-sm px-space-lg font-headline-sm text-headline-sm transition-all ${
                  disabled
                    ? "cursor-not-allowed text-on-surface-variant/50"
                    : active
                      ? "border-b-2 border-primary text-primary"
                      : "text-secondary hover:text-on-surface"
                }`}
              >
                <Icon name={t.icon} size={17} />
                {t.label}
                {t.needsSwitchboard && selectedSwitchboard && (
                  <span className="font-mono text-[10px] text-on-surface-variant">{selectedSwitchboard.switchboard.tag}</span>
                )}
              </button>
            );
          })}
        </nav>
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
            allItems={allItems}
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
