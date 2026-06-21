// =============================================================================
// components/HeaderStats.tsx — live counters for the status bar
// =============================================================================
// Isolated on purpose: this is the ONLY part of the header that needs the
// 1 Hz tick, so it subscribes alone and the rest of the header (and page)
// stays static.
// =============================================================================

"use client";

import { AlertTriangle } from "lucide-react";
import { useTrackerSnapshot } from "@/hooks/useTracker";

export default function HeaderStats() {
  const { objects, totalOverhead, lastTleSync, tickTime, error } = useTrackerSnapshot();

  return (
    <div className="ml-auto flex items-center gap-4 font-mono text-xs text-stardust">
      {error && (
        <span className="flex items-center gap-1 rounded bg-alert/15 px-2 py-1 text-alert" role="alert">
          <AlertTriangle size={12} /> {error}
        </span>
      )}
      <span className="hidden md:inline">
        TRACKING <span className="text-zenith-cyan">{objects.length}</span> OBJECTS
      </span>
      <span>
        <span className="text-signal">{totalOverhead}</span> IN YOUR SKY
      </span>
      {lastTleSync && (
        <span className="hidden lg:inline text-faint">
          TLE SYNC {lastTleSync.toUTCString().slice(17, 25)}
        </span>
      )}
      {tickTime && (
        <span className="hidden xl:inline text-faint">{tickTime.toUTCString().slice(17, 25)} UTC</span>
      )}
    </div>
  );
}
