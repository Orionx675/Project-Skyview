// =============================================================================
// hooks/useIsMobile.ts — viewport-width breakpoint, SSR/hydration-safe
// =============================================================================
// Returns true below `breakpoint` px (default 768 — tablet/phone). It is
// deliberately `false` on the server AND on the first client render so the
// hydrated HTML matches the server HTML (no hydration mismatch). The real
// value is read only AFTER mount, inside an effect, then kept in sync with
// window resize / orientation changes. A brief desktop→mobile flip on a phone
// is hidden behind the boot IntroOverlay.
// =============================================================================

"use client";

import { useEffect, useState } from "react";

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update(); // read the real value once mounted (client only)
    // `change` covers resize + device rotation without a resize storm.
    mql.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [breakpoint]);

  return isMobile;
}
