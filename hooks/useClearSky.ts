// =============================================================================
// hooks/useClearSky.ts — fetch weather + scan passes + cross-reference
// =============================================================================
// Orchestrates the Clear Sky planner data when its panel is open:
//   1. FETCH the hourly forecast for the observer from /api/weather.
//   2. SCAN the tracker's bright LEO satellites for visible passes (>10°) over
//      the next 24 h with SGP4 (predictPasses). This is the heavy step, so it
//      runs deferred (off the open-animation frame) behind a loading state.
//   3. CROSS-REFERENCE passes against the forecast → graded SkyWindows.
//
// Only naked-eye-relevant LEO layers are scanned; GPS (MEO, always up, never
// visible) is excluded so the forecast stays meaningful for casual users.
// =============================================================================

"use client";

import { useEffect, useState } from "react";
import { useTracker } from "@/hooks/useTracker";
import { predictPasses } from "@/utils/orbitalMath";
import { computeSkyWindows, type SkyWindow, type VisiblePass, type WeatherHour } from "@/lib/clearSky";
import type { Observer } from "@/lib/layers";

/** Layers worth scanning for naked-eye passes (excludes MEO GPS, planets). */
const STARGAZING_LAYERS = new Set(["stations", "brightest", "starlink"]);
/** Cap on satellites scanned, to bound the pass-prediction cost. */
const MAX_SATELLITES = 30;

export interface ClearSkyState {
  loading: boolean;
  error: string | null;
  windows: SkyWindow[];
  /** Whether any bright satellite layer is currently enabled. */
  hasSatellites: boolean;
  fetchedAt: Date | null;
}

export function useClearSky(observer: Observer, active: boolean): ClearSkyState {
  const tracker = useTracker();
  const [state, setState] = useState<ClearSkyState>({
    loading: false,
    error: null,
    windows: [],
    hasSatellites: false,
    fetchedAt: null,
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      // 1. weather --------------------------------------------------------
      let weather: WeatherHour[] = [];
      try {
        const res = await fetch(`/api/weather?lat=${observer.latitude}&lon=${observer.longitude}`);
        if (!res.ok) throw new Error(`Weather unavailable (${res.status})`);
        const data = (await res.json()) as { hours?: WeatherHour[] };
        weather = data.hours ?? [];
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            error: err instanceof Error ? err.message : "Weather unavailable",
            windows: [],
            hasSatellites: false,
            fetchedAt: null,
          });
        }
        return;
      }
      if (cancelled) return;

      // 2. passes (deferred — keeps the panel's entrance animation smooth) -
      setTimeout(() => {
        if (cancelled) return;
        const now = new Date();
        const sats = tracker
          .getCatalog()
          .filter((e) => e.kind === "satellite" && e.satrec && STARGAZING_LAYERS.has(e.layerId))
          .slice(0, MAX_SATELLITES);

        const passes: VisiblePass[] = [];
        for (const entry of sats) {
          const list = predictPasses(entry.satrec!, observer, {
            startTime: now,
            hours: 24,
            stepSeconds: 60, // 1-min scan is plenty for ~6-min LEO passes
            minElevation: 10,
            maxPasses: 4,
          }) as {
            start: Date;
            end: Date;
            maxAltitude: number;
            maxAltitudeTime: Date;
            startAzimuth: number;
            endAzimuth: number;
            continuous: boolean;
          }[];

          for (const p of list) {
            if (p.continuous) continue; // never-setting object — not a "pass"
            passes.push({
              objectId: entry.id,
              name: entry.name,
              color: entry.color,
              start: p.start,
              peak: p.maxAltitudeTime,
              end: p.end,
              maxAltitude: p.maxAltitude,
              startAzimuth: p.startAzimuth,
              endAzimuth: p.endAzimuth,
            });
          }
        }

        // 3. cross-reference ---------------------------------------------
        const windows = computeSkyWindows(passes, weather, observer);
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            windows,
            hasSatellites: sats.length > 0,
            fetchedAt: new Date(),
          });
        }
      }, 60);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, observer.latitude, observer.longitude, tracker]);

  return state;
}
