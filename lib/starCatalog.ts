// =============================================================================
// lib/starCatalog.ts — star/DSO data ingestion + celestial coordinate math
// =============================================================================
// Framework-free (the only Cesium touch is an injected module for the
// Cartesian3 factory, so this stays unit-testable). Handles:
//   · Loading + filtering the catalogs (stars to naked-eye mag < 6.0).
//   · RA/Dec  ->  Cartesian3 on a celestial sphere (inertial equatorial frame).
//   · Visual magnitude -> point pixel size.
//   · B-V color index  -> star RGB (blue-hot to red-cool).
//
// COORDINATE FRAME: positions are computed in the INERTIAL equatorial frame
// (x → vernal equinox, z → north celestial pole). The renderer rotates the
// whole collection to Earth-fixed each frame via a GMST modelMatrix, so the
// sky aligns with the rotating globe + satellites and drifts with sidereal
// time exactly like the real sky. See hooks/useRegaliaSky.ts.
// =============================================================================

import { gstime } from "satellite.js";
import type * as CesiumNS from "cesium";

export interface Star {
  hip: number;
  name?: string;
  con?: string; // constellation abbreviation
  ra: number; // degrees (0–360)
  dec: number; // degrees (−90–90)
  mag: number; // visual magnitude
  bv: number; // B−V color index
  spect?: string; // spectral type
  dist?: number; // distance, light-years
}

export interface ConstellationDef {
  name: string;
  abbr: string;
  /** Stick-figure edges as pairs of Hipparcos ids. */
  segments: [number, number][];
}

export interface MessierObject {
  id: string; // "M31"
  name: string;
  type: string; // Galaxy / Nebula / Open Cluster / ...
  con?: string;
  ra: number; // degrees
  dec: number; // degrees
  mag: number;
  dist: number; // light-years
}

/**
 * Radius of the simulated celestial sphere (meters). Far beyond every tracked
 * satellite (GEO ≈ 42,000 km) yet inside Cesium's default far plane (5e8 m),
 * so stars read as an enclosing dome without being clipped.
 */
export const CELESTIAL_RADIUS_M = 1.5e8;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Transform a star's static equatorial coordinates (RA/Dec, degrees) into the
 * observer's LOCAL horizontal coordinates (altitude/azimuth, degrees) for a
 * given instant — the heart of the Stellarium-style local-horizon view.
 *
 *   · `date` is the simulation time (pass the Cosmic Time Machine's clock so
 *     the sky matches whatever epoch the user scrubbed to).
 *   · GMST (Greenwich Mean Sidereal Time) comes from satellite.js `gstime`,
 *     the same source the rest of the app uses for ECI→ECF — so this stays
 *     perfectly consistent with where the stars are rendered on the dome.
 *
 * altitude < 0  ⇒  the object is below the observer's horizon (hidden).
 * azimuth is measured from North (0°) clockwise through East (90°).
 */
export function localAltAz(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  date: Date
): { altitude: number; azimuth: number } {
  const gmst = gstime(date); // radians
  // Local hour angle = local sidereal time − right ascension.
  const ha = gmst + lonDeg * DEG2RAD - raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const lat = latDeg * DEG2RAD;

  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG;

  // North-based azimuth: 0°=N, 90°=E, 180°=S, 270°=W.
  const azimuth =
    (Math.atan2(
      -Math.cos(dec) * Math.sin(ha),
      Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(ha) * Math.sin(lat)
    ) *
      RAD2DEG +
      360) %
    360;

  return { altitude, azimuth };
}

/**
 * Convert equatorial coordinates to a Cartesian3 on the celestial sphere, in
 * the INERTIAL equatorial frame. (Cesium module injected to avoid a static
 * import here.)
 */
export function raDecToCartesian(
  raDeg: number,
  decDeg: number,
  radius: number,
  Cesium: typeof CesiumNS
): CesiumNS.Cartesian3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return new Cesium.Cartesian3(
    radius * cosDec * Math.cos(ra),
    radius * cosDec * Math.sin(ra),
    radius * Math.sin(dec)
  );
}

/**
 * Visual magnitude → point pixel size. Brighter (lower magnitude) → larger.
 * Clamped so even faint mag-6 stars stay visible/clickable and the brightest
 * don't bloom out of proportion.
 */
export function magnitudeToPixelSize(mag: number): number {
  return Math.max(2, Math.min(8, 2.2 + (6.5 - mag) * 0.85));
}

// B−V color anchors (index → linear RGB 0–1), hot/blue to cool/red.
const BV_STOPS: { bv: number; rgb: [number, number, number] }[] = [
  { bv: -0.40, rgb: [0.61, 0.70, 1.0] },
  { bv: 0.00, rgb: [0.78, 0.86, 1.0] },
  { bv: 0.40, rgb: [1.0, 0.96, 0.92] },
  { bv: 0.80, rgb: [1.0, 0.93, 0.75] },
  { bv: 1.20, rgb: [1.0, 0.85, 0.59] },
  { bv: 1.60, rgb: [1.0, 0.74, 0.48] },
  { bv: 2.00, rgb: [1.0, 0.62, 0.43] },
];

/** B−V color index → approximate star RGB (0–1), interpolated between anchors. */
export function bvToColorRgb(bv: number): [number, number, number] {
  if (bv <= BV_STOPS[0].bv) return BV_STOPS[0].rgb;
  const last = BV_STOPS[BV_STOPS.length - 1];
  if (bv >= last.bv) return last.rgb;
  for (let i = 0; i < BV_STOPS.length - 1; i++) {
    const a = BV_STOPS[i];
    const b = BV_STOPS[i + 1];
    if (bv >= a.bv && bv <= b.bv) {
      const f = (bv - a.bv) / (b.bv - a.bv);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f,
      ];
    }
  }
  return [1, 1, 1];
}

/* ----------------------------- loaders ----------------------------------- */

/**
 * Load the Hipparcos-style star catalog and filter to naked-eye visibility.
 * The bundled file is a curated bright-star set; drop a full mag-sorted
 * Hipparcos JSON at the same path and this scales to thousands unchanged.
 */
export async function loadStarCatalog(maxMagnitude = 6.0): Promise<Star[]> {
  const res = await fetch("/data/stars.json");
  if (!res.ok) throw new Error(`stars.json ${res.status}`);
  const all = (await res.json()) as Star[];
  return all.filter((s) => s.mag < maxMagnitude);
}

export async function loadConstellations(): Promise<ConstellationDef[]> {
  const res = await fetch("/data/constellations.json");
  if (!res.ok) throw new Error(`constellations.json ${res.status}`);
  return (await res.json()) as ConstellationDef[];
}

export async function loadMessier(): Promise<MessierObject[]> {
  const res = await fetch("/data/messier.json");
  if (!res.ok) throw new Error(`messier.json ${res.status}`);
  return (await res.json()) as MessierObject[];
}

/** Distinct accent per DSO category, for markers + the inspector. */
export function dsoCategoryColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("galaxy")) return "#a78bfa"; // aurora violet
  if (t.includes("nebula")) return "#fb7185"; // alert pink
  return "#2dd4ff"; // clusters → cyan
}
