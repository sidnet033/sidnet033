"use client";

import { useEffect } from "react";

// Shows the "working in the background" cursor (arrow + spinner) while the
// app waits on the network -- page navigation, router refreshes, Supabase
// reads and saves all go through fetch. Counts requests in flight and only
// switches the cursor once one has taken longer than DELAY_MS, so instant
// responses don't flicker. A click on an in-app link sets it straight away
// (the page change follows).
const DELAY_MS = 150;

export function BusyCursor() {
  useEffect(() => {
    const root = document.documentElement;
    let inFlight = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const update = () => {
      if (inFlight > 0) {
        if (!timer && !root.classList.contains("app-busy")) {
          timer = setTimeout(() => {
            timer = null;
            if (inFlight > 0) root.classList.add("app-busy");
          }, DELAY_MS);
        }
      } else {
        if (timer) clearTimeout(timer);
        timer = null;
        root.classList.remove("app-busy");
      }
    };

    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      inFlight++;
      update();
      try {
        return await originalFetch(...args);
      } finally {
        inFlight = Math.max(0, inFlight - 1);
        update();
      }
    };

    // in-app link clicks: busy until the navigation's fetches finish (or a
    // short fallback if the page was already cached)
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      root.classList.add("app-busy");
      setTimeout(() => {
        if (inFlight === 0) root.classList.remove("app-busy");
      }, 800);
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.fetch = originalFetch;
      document.removeEventListener("click", onClick, true);
      if (timer) clearTimeout(timer);
      root.classList.remove("app-busy");
    };
  }, []);

  return null;
}
