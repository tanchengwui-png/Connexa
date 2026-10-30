"use client";

import { useEffect } from "react";

/** Keeps sticky page controls and anchor targets below the measured global header. */
export function DashboardHeaderOffset() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".dashboard-topbar");
    if (!header) return;
    const update = () => document.documentElement.style.setProperty("--app-header-height", `${header.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  return null;
}
