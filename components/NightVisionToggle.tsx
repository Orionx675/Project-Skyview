// =============================================================================
// components/NightVisionToggle.tsx — astrophotographer's red-light switch
// =============================================================================
// Flips a single `night-vision` class on <html>. Because the whole design
// system is token-driven (app/globals.css), that one class repaints every
// token-based surface/text/accent deep red — preserving dark-adapted vision
// at the eyepiece. Fully self-contained: it owns its own state + localStorage
// persistence, so it needs no wiring through page.tsx or SkyViewProps.
//
// Hydration-safe: renders "off" on the server and first client paint, then
// reads the saved preference in an effect (the class is applied to <html>, not
// to this element, so there's no markup mismatch to reconcile).
// =============================================================================

"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Moon } from "lucide-react";

const STORAGE_KEY = "skyview:night-vision";

export default function NightVisionToggle({
  showLabel = false,
  className = "",
}: {
  /** Render the "NIGHT VISION" text label beside the icon (used in the sheet). */
  showLabel?: boolean;
  className?: string;
}) {
  const [on, setOn] = useState(false);

  // Apply the persisted preference once mounted (client only).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) === "1";
    setOn(saved);
    document.documentElement.classList.toggle("night-vision", saved);
  }, []);

  const toggle = () =>
    setOn((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("night-vision", next);
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* private mode / storage disabled — the toggle still works for the session */
      }
      return next;
    });

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      aria-pressed={on}
      aria-label="Night Vision mode"
      title="Night Vision — red light preserves dark-adapted sight"
      className={`focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 border font-mono
        text-[10px] font-bold tracking-widest transition-colors ${
          on
            ? "border-alert/60 bg-alert/15 text-alert"
            : "border-grid text-stardust hover:bg-panel-raised hover:text-starlight"
        } ${className}`}
    >
      <Moon size={showLabel ? 14 : 16} className={on ? "fill-current" : ""} />
      {showLabel && <span>NIGHT VISION</span>}
    </motion.button>
  );
}
