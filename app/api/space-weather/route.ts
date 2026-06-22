// =============================================================================
// app/api/space-weather/route.ts — NOAA planetary K-index proxy
// =============================================================================
// GET /api/space-weather
//
// Feeds the Space Weather & Aurora Forecaster. We proxy NOAA's Space Weather
// Prediction Center (SWPC) server-side for the same reasons as our other API
// routes:
//   · CACHING — Kp is published on a ~3-hour cadence; a 15-minute shared Data
//     Cache means one upstream hit per window across all visitors, well clear
//     of any client-side rate limits.
//   · NORMALIZATION — SWPC's feed shape has drifted between an array-of-arrays
//     (header row + rows) and an array-of-objects over the years, so we parse
//     BOTH defensively and hand the client one tidy, stable object.
//   · RESILIENCE — if NOAA is unreachable or returns an anomalous structure we
//     fall back to a calm baseline Kp of 2 (HTTP 200) so the render tree never
//     crashes; the client treats `fallback: true` as "no live data".
//
// Kp is the 0–9 planetary geomagnetic index. The NOAA "G" storm scale maps
// Kp 5→G1 … Kp 9→G5 (G = Kp − 4); below Kp 5 there is no storm (G0).
// =============================================================================

import { NextResponse } from "next/server";

// NOAA SWPC planetary-K feeds, tried in order. The 1-minute feed is freshest
// (estimated "nowcast" Kp, updated every minute) with a clean integer
// `kp_index`; the products feed is the official 3-hourly Kp as a fallback.
// (The bare `planetary-k-index-recent.json` path 404s — these are its live
// equivalents.)
const SWPC_ENDPOINTS = [
  "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
];

/** Calm baseline used whenever live data is unavailable or malformed. */
const FALLBACK_KP = 2;

/** Revalidate this route's cached upstream fetch every 15 minutes. */
export const revalidate = 900;

interface ParsedKp {
  kpFraction: number;
  observedTime: string | null;
}

const clampKp = (value: number): number => Math.min(9, Math.max(0, value));

/** Pull a numeric Kp out of a cell that may read "4", "4.33", "4P", "5M", etc. */
function coerceKp(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const match = String(raw).match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

/**
 * Extract the most recent Kp reading from either NOAA payload shape:
 *   A) array of objects:  [{ time_tag, kp_index|kp|estimated_kp, ... }, ...]
 *   B) array of arrays:   [["time_tag","Kp_index",...], ["2026-…","4",...], ...]
 * Returns null when the structure is unrecognized or empty.
 */
function extractLatestKp(data: unknown): ParsedKp | null {
  if (!Array.isArray(data) || data.length === 0) return null;

  // -- Shape A: array of objects --------------------------------------------
  // Keys seen across SWPC feeds: estimated_kp (float nowcast), kp_index (int),
  // Kp (float, capitalised in the products feed), kp ("0P"/"4M" string).
  if (typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
    const rows = data as Record<string, unknown>[];
    const last = rows[rows.length - 1];
    const raw =
      last.estimated_kp ?? last.kp_index ?? last.Kp ?? last.kp ?? last.kp_value;
    const kpFraction = coerceKp(raw);
    if (!Number.isFinite(kpFraction)) return null;
    const observedTime = typeof last.time_tag === "string" ? last.time_tag : null;
    return { kpFraction, observedTime };
  }

  // -- Shape B: array of arrays with a header row ---------------------------
  if (Array.isArray(data[0])) {
    const header = (data[0] as unknown[]).map((h) => String(h).toLowerCase());
    // Prefer an exact "kp" column, else any header mentioning kp.
    let kpIdx = header.findIndex((h) => h === "kp_index" || h === "kp");
    if (kpIdx < 0) kpIdx = header.findIndex((h) => h.includes("kp"));
    const timeIdx = header.findIndex((h) => h.includes("time"));
    const rows = data.slice(1) as unknown[][];
    if (kpIdx < 0 || rows.length === 0) return null;

    const last = rows[rows.length - 1];
    const kpFraction = coerceKp(last[kpIdx]);
    if (!Number.isFinite(kpFraction)) return null;
    const observedTime = timeIdx >= 0 ? String(last[timeIdx]) : null;
    return { kpFraction, observedTime };
  }

  return null;
}

/** Calm-baseline body returned whenever live data is unavailable. */
function fallbackPayload(reason: string) {
  return {
    kp: FALLBACK_KP,
    kpFraction: FALLBACK_KP,
    gScale: 0,
    observedTime: null,
    source: "fallback",
    fallback: true,
    reason,
  };
}

export async function GET() {
  let lastReason = "no endpoint reached";

  for (const url of SWPC_ENDPOINTS) {
    try {
      const upstream = await fetch(url, {
        next: { revalidate: 900 },
        headers: { Accept: "application/json", "User-Agent": "ProjectSkyView/1.0 (+hackathon)" },
      });
      if (!upstream.ok) {
        lastReason = `SWPC responded ${upstream.status}`;
        continue; // try the next endpoint
      }

      const data: unknown = await upstream.json();
      const parsed = extractLatestKp(data);
      if (!parsed) {
        lastReason = "Unrecognized SWPC payload structure";
        continue;
      }

      const kp = clampKp(Math.round(parsed.kpFraction));
      const gScale = kp >= 5 ? kp - 4 : 0;

      return NextResponse.json(
        {
          kp,
          kpFraction: parsed.kpFraction,
          gScale,
          observedTime: parsed.observedTime,
          source: "NOAA SWPC",
          fallback: false,
        },
        { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=300" } }
      );
    } catch (err) {
      lastReason = err instanceof Error ? err.message : "fetch failed";
    }
  }

  // Every endpoint failed — seamless calm fallback so the client never crashes.
  // Short cache so it retries on the next request.
  return NextResponse.json(fallbackPayload(lastReason), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
