"use client";

import { Icon } from "@/components/icon";

export function Modal({
  open,
  onClose,
  icon,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  icon: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 p-space-md backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-surface-container-low p-space-lg">
          <div className="flex items-center gap-space-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-on-primary">
              <Icon name={icon} size={18} />
            </span>
            <div>
              <h3 className="font-headline-md text-headline-md text-on-surface">{title}</h3>
              <p className="font-body-sm text-body-sm text-secondary">{description}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-secondary hover:text-on-surface">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="space-y-space-md p-space-lg">{children}</div>
      </div>
    </div>
  );
}
