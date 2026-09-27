"use client";

import { Fragment, useState } from "react";
import type { ImportLog } from "@/types/database";
import { Icon } from "@/components/icon";

const SOURCE_LABELS: Record<ImportLog["source"], string> = {
  xlsx_upload: "CSV / Excel upload",
  google_sheet_sync: "Google Sheet sync",
  feeder_xlsx_upload: "Feeder XLS upload",
};

export function ImportLogTable({ logs }: { logs: ImportLog[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-[8px] bg-surface-container-lowest p-8 text-center text-sm text-secondary shadow-sm">
        No imports yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[8px] bg-surface-container-lowest shadow-sm">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-container text-[10px] font-semibold uppercase tracking-wide text-secondary">
          <tr className="h-9 border-b border-outline-variant/30">
            <th className="px-3">Timestamp</th>
            <th className="px-3">Source</th>
            <th className="px-3">File</th>
            <th className="px-3 text-right">New</th>
            <th className="px-3 text-right">Updated</th>
            <th className="px-3 text-right">Failed</th>
            <th className="px-3">Imported By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-container">
          {logs.map((log) => {
            const isFeederImport = log.source === "feeder_xlsx_upload";
            const feedersExtended = log.details?.feeders_extended ?? 0;
            const linesAdded = log.details?.lines_added ?? 0;
            const expandable = log.failed_count > 0 || (isFeederImport && feedersExtended > 0);
            return (
              <Fragment key={log.id}>
                <tr className={`h-9 ${expandable ? "cursor-pointer hover:bg-surface-container-low" : ""}`} onClick={() => expandable && toggle(log.id)}>
                  <td className="px-3 font-display text-on-surface">
                    {new Date(log.created_at).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 text-on-surface-variant">{SOURCE_LABELS[log.source]}</td>
                  <td className="px-3 text-secondary">{log.file_name || "—"}</td>
                  <td className="px-3 text-right font-display font-bold text-tertiary">
                    {log.created_count}
                    {isFeederImport && <div className="text-[9px] font-normal normal-case text-secondary">feeders</div>}
                  </td>
                  <td className="px-3 text-right font-display font-bold text-on-surface">
                    {log.updated_count}
                    {isFeederImport && <div className="text-[9px] font-normal normal-case text-secondary">items</div>}
                  </td>
                  <td className="px-3 text-right">
                    {expandable ? (
                      <span className="inline-flex items-center gap-1 font-display font-bold text-error">
                        {log.failed_count}
                        <Icon name={expanded.has(log.id) ? "expand_less" : "expand_more"} size={14} />
                      </span>
                    ) : (
                      <span className="text-secondary">{log.failed_count}</span>
                    )}
                  </td>
                  <td className="px-3 text-on-surface-variant">{log.imported_by_name || "—"}</td>
                </tr>
                {expanded.has(log.id) && expandable && (
                  <tr className={feedersExtended > 0 || log.failed_count === 0 ? "bg-secondary-container/20" : "bg-error-container/30"}>
                    <td colSpan={7} className="px-3 py-2">
                      <div className="space-y-1">
                        {isFeederImport && feedersExtended > 0 && (
                          <p className="text-[11px] text-on-surface-variant">
                            <span className="font-semibold">{feedersExtended}</span> existing feeder(s) extended with{" "}
                            <span className="font-semibold">{linesAdded}</span> new line(s).
                          </p>
                        )}
                        {log.failures.map((f, i) => (
                          <p key={i} className="text-[11px] text-on-error-container">
                            <span className="font-semibold">{f.row > 0 ? `Row ${f.row}:` : ""}</span> {f.reason}
                          </p>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
