// =============================================================================
// lib/sheetDrag.ts — handle-driven drag-to-dismiss for mobile bottom sheets
// =============================================================================
// Returns Framer Motion props for a mobile bottom sheet that the user can drag
// DOWN (from its grab handle) to dismiss. Drag is initiated ONLY by the handle
// (dragListener:false + dragControls) so the sheet's own scrollable content
// still scrolls normally — the classic iOS/Android bottom-sheet behaviour.
//
//   const { sheetProps, handleProps } = useSheetDrag(onClose, isMobile);
//   <motion.aside {...sheetProps}> <div {...handleProps}>⎯</div> ... </motion.aside>
//
// Pass enabled=false on desktop so side-panels stay non-draggable.
// =============================================================================

"use client";

import { useDragControls, type PanInfo } from "framer-motion";
import type { PointerEvent as ReactPointerEvent } from "react";

const DISMISS_OFFSET = 110; // px dragged down
const DISMISS_VELOCITY = 650; // downward flick

export function useSheetDrag(onClose: () => void, enabled: boolean) {
  const controls = useDragControls(); // called unconditionally (hook rules)

  if (!enabled) return { sheetProps: {}, handleProps: {} };

  return {
    sheetProps: {
      drag: "y" as const,
      dragListener: false, // only the handle starts a drag
      dragControls: controls,
      dragConstraints: { top: 0, bottom: 0 },
      dragElastic: { top: 0, bottom: 0.6 },
      onDragEnd: (_event: unknown, info: PanInfo) => {
        if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) onClose();
      },
    },
    handleProps: {
      onPointerDown: (e: ReactPointerEvent) => controls.start(e),
      style: { touchAction: "none" as const },
    },
  };
}
