// =============================================================================
// components/AuroraLayer.tsx — binds the aurora-oval rings to the live globe
// =============================================================================
// Renders nothing in the DOM. It picks up the active Cesium viewer (via the
// viewer bridge) and the current Kp index (via the space-weather context), and
// drives the imperative AuroraOvalLayer that paints green rings on the globe.
//
// Mounted INSIDE each view's globe section, because every view mounts its own
// Cesium viewer — so the rings live and die with whichever globe is on screen.
// All Cesium primitives are torn down on unmount (no leaks across view swaps).
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { useViewerBridge } from "@/lib/viewerBridge";
import { useSpaceWeather } from "@/hooks/useSpaceWeather";
import { AuroraOvalLayer } from "@/lib/auroraOval";

export default function AuroraLayer() {
  const bridge = useViewerBridge();
  const { kp } = useSpaceWeather();
  const layerRef = useRef<AuroraOvalLayer | null>(null);

  // Create/destroy the imperative layer with the viewer lifecycle.
  useEffect(() => {
    if (!bridge) return;
    const layer = new AuroraOvalLayer(bridge.viewer, bridge.Cesium);
    layerRef.current = layer;
    return () => {
      layer.destroy();
      layerRef.current = null;
    };
  }, [bridge]);

  // Redraw on Kp change — and on viewer change, so a freshly mounted globe
  // (e.g. after a desktop⇄mobile swap) immediately gets the current rings.
  useEffect(() => {
    if (bridge && layerRef.current) layerRef.current.update(kp);
  }, [bridge, kp]);

  return null;
}
