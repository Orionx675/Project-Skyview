// =============================================================================
// components/ui/Modal.tsx — animated dialog shell (AnimatePresence)
// =============================================================================
// Backdrop fades; the panel enters with a spring scale+rise and exits with a
// quick fade-drop. AnimatePresence keeps the exiting modal mounted until its
// animation completes — that's what makes closing feel physical instead of
// the DOM just vanishing.
// =============================================================================

"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** id of the element that titles the dialog (aria-labelledby). */
  labelledBy?: string;
  children: React.ReactNode;
}

export default function Modal({ open, onClose, labelledBy, children }: ModalProps) {
  // Escape closes — listener only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Click-away backdrop (blur signals the panel is dismissible) */}
          <div
            className="absolute inset-0 bg-void/80 backdrop-blur-md"
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ opacity: 0, scale: 0.94, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="glass-raised scrollbar-thin relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
