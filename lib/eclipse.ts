// =============================================================================
// lib/eclipse.ts — is a satellite in Earth's shadow right now?
// =============================================================================
// Satellites in low Earth orbit spend roughly a third of every orbit inside
// Earth's shadow ("orbital night"), during which optical video feeds from them
// go completely black. This module estimates that state geometrically so the
// ISS live-stream widget can swap a black feed for an explanatory overlay.
//
// Method — a standard first-order *cylindrical umbra* test, done entirely in
// the inertial (ECI) frame so no Earth-rotation bookkeeping is needed:
//   1. Get the satellite's ECI position from SGP4 (satellite.js).
//   2. Get a unit vector pointing from Earth's centre toward the Sun, using the
//      low-precision solar formula from the Astronomical Almanac (~0.01°).
//   3. If the satellite sits on the sunward side of Earth it is lit. Otherwise
//      project it onto the Earth–Sun axis: it is eclipsed when its
//      perpendicular distance from that axis is less than Earth's radius (i.e.
//      it falls inside the cylindrical shadow behind the planet).
//
// This ignores the umbra's slight conical taper and the penumbra, which is far
// finer than we need for a "is the camera dark?" UI cue.
// =============================================================================

import { propagate } from "satellite.js";
import type { SatRec } from "satellite.js";

/** Mean Earth radius in km (good enough for a shadow-cylinder test). */
const EARTH_RADIUS_KM = 6371;

const DEG2RAD = Math.PI / 180;

/**
 * Geocentric unit vector toward the Sun in the equatorial-of-date (≈ECI/TEME)
 * frame. Low-precision Almanac series — accurate to ~0.01°, which is orders of
 * magnitude finer than the shadow geometry requires.
 */
export function sunUnitVectorEci(date: Date): { x: number; y: number; z: number } {
  // Julian date, then days since the J2000.0 epoch.
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;

  const meanLongitude = (280.46 + 0.985_647_4 * n) * DEG2RAD;
  const meanAnomaly = (357.528 + 0.985_600_3 * n) * DEG2RAD;
  const eclipticLongitude =
    meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG2RAD;
  const obliquity = (23.439 - 0.000_000_4 * n) * DEG2RAD;

  return {
    x: Math.cos(eclipticLongitude),
    y: Math.cos(obliquity) * Math.sin(eclipticLongitude),
    z: Math.sin(obliquity) * Math.sin(eclipticLongitude),
  };
}

/**
 * Estimate whether a satellite is currently inside Earth's shadow.
 * Returns false (assume lit) on any propagation failure, so callers never have
 * to guard against decayed/corrupt elements.
 *
 * @param satrec  Compiled SGP4 record (from the tracker catalog).
 * @param date    Instant to evaluate at (defaults to now).
 */
export function isSatelliteInEclipse(satrec: SatRec, date: Date = new Date()): boolean {
  let propagated;
  try {
    propagated = propagate(satrec, date);
  } catch {
    return false;
  }

  const position = propagated?.position;
  // satellite.js signals failure with a falsy or boolean position.
  if (!position || typeof position === "boolean") return false;

  const sun = sunUnitVectorEci(date);

  // Component of the satellite position along the Earth→Sun axis.
  const alongSun = position.x * sun.x + position.y * sun.y + position.z * sun.z;
  // On the sunward hemisphere → always lit.
  if (alongSun >= 0) return false;

  // Perpendicular distance from the Earth–Sun axis (the shadow cylinder radius).
  const distanceSq =
    position.x * position.x + position.y * position.y + position.z * position.z;
  const perpendicular = Math.sqrt(Math.max(0, distanceSq - alongSun * alongSun));

  return perpendicular < EARTH_RADIUS_KM;
}
