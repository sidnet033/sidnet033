"use client";

import { Fragment, useState } from "react";
import type { ImportLog } from "@/types/database";
import { Icon } from "@/components/icon";

const SOURCE_LABELS: Record<ImportLog["source"], string> = {
  xlsx_upload: "CSV / Excel upload",
  google_sheet_sync: "Google Sheet sync",
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
          {logs.map((log) => (
            <Fragment key={log.id}>
              <tr
                className={`h-9 ${log.failed_count > 0 ? "cursor-pointer hover:bg-surface-container-low" : ""}`}
                onClick={() => log.failed_count > 0 && toggle(log.id)}
              >
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
                <td className="px-3 text-right font-display font-bold text-tertiary">{log.created_count}</td>
                <td className="px-3 text-right font-display font-bold text-on-surface">{log.updated_count}</td>
                <td className="px-3 text-right">
                  {log.failed_count > 0 ? (
                    <span className="inline-flex items-center gap-1 font-display font-bold text-error">
                      {log.failed_count}
                      <Icon name={expanded.has(log.id) ? "expand_less" : "expand_more"} size={14} />
                    </span>
                  ) : (
                    <span className="text-secondary">0</span>
                  )}
                </td>
                <td className="px-3 text-on-surface-variant">{log.imported_by_name || "—"}</td>
              </tr>
              {expanded.has(log.id) && log.failed_count > 0 && (
                <tr className="bg-error-container/30">
                  <td colSpan={7} className="px-3 py-2">
                    <div className="space-y-1">
                      {log.failures.map((f, i) => (
                        <p key={i} className="text-[11px] text-on-error-container">
                          <span className="font-semibold">Row {f.row}:</span> {f.reason}
                        </p>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
