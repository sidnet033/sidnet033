"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icon";

// Plain centred dialog: dimmed backdrop, title bar with a close button,
// closes on Escape or a backdrop click.
export function Modal({
  title,
  onClose,
  width = "max-w-2xl",
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-space-md backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[85vh] w-full ${width} flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-surface-container-high px-space-lg py-space-sm">
          <h3 className="font-headline-md text-headline-md text-on-surface">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-secondary hover:bg-surface-container hover:text-on-surface"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-space-lg">{children}</div>
      </div>
    </div>
  );
}
