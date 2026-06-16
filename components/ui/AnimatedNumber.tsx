// =============================================================================
// components/ui/AnimatedNumber.tsx — spring-smoothed live numerals
// =============================================================================
// Telemetry arrives in 1 Hz steps; raw numbers would visibly "snap". A
// framer-motion spring glides between samples instead — and because the
// formatted string is a MotionValue rendered as a motion.span child, the
// per-frame updates write STRAIGHT to the DOM text node. Zero React
// re-renders during the animation.
// =============================================================================

"use client";

import { useEffect } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  /** Fraction digits to display. */
  decimals?: number;
  /** Appended inside the same text node (e.g. "°", " km"). */
  suffix?: string;
  /** Use grouping separators ("11,818"). Forces decimals=0. */
  grouped?: boolean;
  className?: string;
}

export default function AnimatedNumber({
  value,
  decimals = 1,
  suffix = "",
  grouped = false,
  className,
}: AnimatedNumberProps) {
  // Critically-damped-ish spring: settles in well under the 1 s tick gap,
  // so it never lags more than one sample behind reality.
  const spring = useSpring(value, { stiffness: 110, damping: 26, mass: 0.7 });

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  const display = useTransform(spring, (v) =>
    grouped ? `${Math.round(v).toLocaleString()}${suffix}` : `${v.toFixed(decimals)}${suffix}`
  );

  return <motion.span className={className}>{display}</motion.span>;
}
