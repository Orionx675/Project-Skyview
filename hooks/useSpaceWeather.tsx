// =============================================================================
// hooks/useSpaceWeather.tsx — live geomagnetic state, shared app-wide
// =============================================================================
// One provider owns a single poll of /api/space-weather and shares the result
// with every consumer (the warning banner, the aurora rings), so we never fan
// out duplicate fetches. The serverless route already caches NOAA for 15 min;
// the client re-polls on the same cadence to pick up the next window.
//
// Hydration-safe by construction: the initial state is a calm baseline (Kp 2),
// all fetching happens inside useEffect, and no Date/network value touches the
// first render — so the server and client markup match under Next.js 15.
// =============================================================================

"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Calm baseline shown before the first fetch resolves or on any failure. */
const FALLBACK_KP = 2;
/** Client re-poll cadence — matches the route's 15-minute cache window. */
const POLL_MS = 15 * 60 * 1000;

export interface SpaceWeatherState {
  /** Integer planetary Kp index, 0–9. */
  kp: number;
  /** Raw fractional Kp (e.g. 4.33) when available. */
  kpFraction: number;
  /** NOAA "G" storm level, 0 (none) … 5. G = Kp − 4 for Kp ≥ 5. */
  gScale: number;
  /** True once Kp ≥ 5 — an active geomagnetic storm. */
  severe: boolean;
  /** ISO timestamp of the reading, or null when unknown. */
  observedTime: string | null;
  loading: boolean;
  error: string | null;
  /** True when we're showing the baseline because live data was unavailable. */
  fallback: boolean;
  /** Force an immediate re-fetch. */
  refresh: () => void;
}

interface ApiResponse {
  kp?: number;
  kpFraction?: number;
  gScale?: number;
  observedTime?: string | null;
  fallback?: boolean;
}

const SpaceWeatherContext = createContext<SpaceWeatherState | null>(null);

const clampKp = (value: number): number =>
  Math.min(9, Math.max(0, Number.isFinite(value) ? Math.round(value) : FALLBACK_KP));

interface CoreState {
  kp: number;
  kpFraction: number;
  observedTime: string | null;
  loading: boolean;
  error: string | null;
  fallback: boolean;
}

const INITIAL: CoreState = {
  kp: FALLBACK_KP,
  kpFraction: FALLBACK_KP,
  observedTime: null,
  loading: true,
  error: null,
  fallback: true,
};

export function SpaceWeatherProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CoreState>(INITIAL);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/space-weather", { signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiResponse;

      const kp = clampKp(Number(data.kp));
      setState({
        kp,
        kpFraction: Number.isFinite(Number(data.kpFraction)) ? Number(data.kpFraction) : kp,
        observedTime: data.observedTime ?? null,
        loading: false,
        error: null,
        fallback: Boolean(data.fallback),
      });
    } catch (err) {
      if (signal?.aborted) return; // unmounted / superseded — drop silently
      // Network-level failure on the client too: hold the calm baseline.
      setState({
        kp: FALLBACK_KP,
        kpFraction: FALLBACK_KP,
        observedTime: null,
        loading: false,
        error: err instanceof Error ? err.message : "Space weather fetch failed",
        fallback: true,
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const id = setInterval(() => void load(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [load]);

  const value: SpaceWeatherState = {
    kp: state.kp,
    kpFraction: state.kpFraction,
    gScale: state.kp >= 5 ? state.kp - 4 : 0,
    severe: state.kp >= 5,
    observedTime: state.observedTime,
    loading: state.loading,
    error: state.error,
    fallback: state.fallback,
    refresh: () => void load(),
  };

  return <SpaceWeatherContext.Provider value={value}>{children}</SpaceWeatherContext.Provider>;
}

/** Live geomagnetic state. Throws if used outside <SpaceWeatherProvider>. */
export function useSpaceWeather(): SpaceWeatherState {
  const ctx = useContext(SpaceWeatherContext);
  if (!ctx) throw new Error("useSpaceWeather must be used inside <SpaceWeatherProvider>");
  return ctx;
}
