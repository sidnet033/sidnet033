"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Icon } from "@/components/icon";

type ToastState = { title: string; message: string } | null;

const ToastContext = createContext<((title: string, message: string) => void) | null>(null);

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used within a ToastProvider");
  return show;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((title: string, message: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ title, message });
    setVisible(true);
    timeoutRef.current = setTimeout(() => setVisible(false), 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-space-sm rounded-xl bg-on-surface px-space-lg py-space-md text-on-primary shadow-xl transition-all duration-300 ${
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-24 opacity-0"
        }`}
      >
        <Icon name="check_circle" size={20} className="text-tertiary-fixed" />
        {toast && (
          <div>
            <div className="font-headline-sm text-headline-sm">{toast.title}</div>
            <div className="font-body-sm text-body-sm text-secondary-fixed-dim">{toast.message}</div>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
