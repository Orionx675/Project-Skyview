// =============================================================================
// components/ui/ToggleSwitch.tsx — iOS-style switch with a spring-loaded knob
// =============================================================================
// The knob uses framer-motion's `layout` animation: we only flip
// justify-content and the knob springs to its new home — no hand-tuned
// translate distances to keep in sync with the track width.
// =============================================================================

"use client";

import { motion } from "framer-motion";

interface ToggleSwitchProps {
  checked: boolean;
  /** Track color when on (layer accent). */
  color: string;
  disabled?: boolean;
  /** Accessible name for the switch. */
  label: string;
  onChange: () => void;
}

export default function ToggleSwitch({ checked, color, disabled, label, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5
                 transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        backgroundColor: checked ? color : "var(--color-grid)",
        justifyContent: checked ? "flex-end" : "flex-start",
        boxShadow: checked ? `0 0 10px ${color}55` : "none",
      }}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 620, damping: 34 }}
        className="h-4 w-4 rounded-full bg-starlight shadow-md"
      />
    </button>
  );
}
