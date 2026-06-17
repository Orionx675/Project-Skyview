// =============================================================================
// components/LockChip.tsx — floating "target locked" indicator
// =============================================================================
// Lives inside <TrackerProvider> so it can read the live object; auto-releases
// the lock if the target's layer is toggled off (object vanishes). Shared by
// the desktop and mobile views.
// =============================================================================

"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTrackedObject } from "@/hooks/useTracker";

export default function LockChip({
  lockedId,
  onUnlock,
}: {
  lockedId: string | null;
  onUnlock: () => void;
}) {
  const obj = useTrackedObject(lockedId);

  useEffect(() => {
    if (lockedId && obj === null) onUnlock();
  }, [lockedId, obj, onUnlock]);

  return (
    <AnimatePresence>
      {lockedId && obj && (
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.92 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className="absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full
                     border border-zenith-cyan/40 bg-panel/90 py-1.5 pl-3 pr-1.5 shadow-lg
                     shadow-black/40 backdrop-blur-md md:top-4"
        >
          <span className="pulse-live h-1.5 w-1.5 rounded-full bg-zenith-cyan" />
          <span className="font-mono text-[11px] font-semibold tracking-wider text-zenith-cyan">
            TARGET LOCK
          </span>
          <span className="max-w-44 truncate font-mono text-[11px] text-starlight">{obj.name}</span>
          <button
            onClick={onUnlock}
            aria-label="Release target lock"
            className="rounded-full bg-grid/60 px-2 py-0.5 font-mono text-[10px] text-stardust
                       transition-colors hover:bg-alert/20 hover:text-alert"
          >
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
