"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RevisionControls } from "@/components/revision-controls";
import { ProjectDetailTab } from "@/components/project-detail-tab";
import { BomBuilder } from "@/components/bom-builder";
import { GaCanvas } from "@/components/ga-canvas";
import { CostingMatrix } from "@/components/costing-matrix";
import type { RevisionContext } from "@/lib/revision-context";
import type { ItemMaster } from "@/types/database";

export type Tab = "detail" | "bom" | "ga" | "costing";

const TABS: { id: Tab; label: string; needsSwitchboard: boolean }[] = [
  { id: "detail", label: "Project Detail", needsSwitchboard: false },
  { id: "bom", label: "BOM Builder", needsSwitchboard: true },
  { id: "ga", label: "GA Builder", needsSwitchboard: true },
  { id: "costing", label: "Costing Summary", needsSwitchboard: false },
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

  const { revision, project, customer, createdByName, consultantName, salesExecName, siblingRevisions, switchboards } = ctx;

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

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">
      <div className="space-y-3 border-b border-slate-200/90 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Link href="/" className="hover:underline">
              Projects
            </Link>
            <span>/</span>
            <span className="text-slate-700">
              {project.code}
              {customer ? ` · ${customer.name}` : ""}
            </span>
            <span>/</span>
            <span className="font-medium text-slate-900">{project.title}</span>
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

        <nav className="flex gap-1">
          {TABS.map((t) => {
            const disabled = t.needsSwitchboard && !selectedSwitchboardId;
            return (
              <button
                key={t.id}
                onClick={() => !disabled && setActiveTab(t.id)}
                disabled={disabled}
                title={disabled ? "Select a switchboard from Project Detail first" : undefined}
                className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${
                  disabled
                    ? "cursor-not-allowed text-slate-300"
                    : activeTab === t.id
                      ? "border-b-2 border-brand-500 text-brand-600"
                      : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
                {t.needsSwitchboard && selectedSwitchboard && (
                  <span className="ml-1.5 font-mono text-[10px] text-slate-400">{selectedSwitchboard.switchboard.tag}</span>
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
