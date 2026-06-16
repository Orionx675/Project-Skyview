// =============================================================================
// utils/orbitalMath.js — TLE propagation & observer geometry (satellite.js)
// =============================================================================
// This module is the single source of truth for orbital math in Project
// Zenith. It is deliberately framework-free (plain JS, no React, no Cesium)
// so the same functions can run in the browser, in a Web Worker, or inside a
// Next.js route handler without modification.
//
// Terminology cheat-sheet (the words matter in this domain):
//   TLE        Two-Line Element set — the standard text encoding of an orbit.
//   SGP4       The propagator model that turns a TLE + a timestamp into a
//              position/velocity vector. satellite.js implements it.
//   ECI        Earth-Centered Inertial frame (does not rotate with Earth).
//   ECF        Earth-Centered Fixed frame (rotates with Earth) — needed to
//              relate a satellite to a point on the ground.
//   GMST       Greenwich Mean Sidereal Time — the rotation angle that converts
//              ECI -> ECF at a given instant.
//   Azimuth    Compass bearing from the observer (0° = North, 90° = East).
//   Altitude   Angular elevation above the observer's horizon (0° = horizon,
//              90° = directly overhead, i.e. AT ZENITH). Not to be confused
//              with orbital height, which we always call `heightKm`.
// =============================================================================

import { twoline2satrec, propagate, gstime, eciToEcf, eciToGeodetic, ecfToLookAngles } from "satellite.js";

/* ---------------------------------------------------------------------------
 * Small angle helpers (kept local so this file has zero soft dependencies on
 * satellite.js's utility surface, which has shifted between major versions).
 * ------------------------------------------------------------------------- */
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Normalize degrees into [0, 360). */
const wrap360 = (deg) => ((deg % 360) + 360) % 360;

/* ---------------------------------------------------------------------------
 * TLE parsing
 * ------------------------------------------------------------------------- */

/**
 * Parse a raw TLE file (as served by CelesTrak with FORMAT=tle) into records.
 * The format is repeating 3-line groups: name line, then line 1, then line 2.
 *
 * @param {string} rawText  Raw response body from CelesTrak.
 * @returns {Array<{ name: string, line1: string, line2: string }>}
 */
export function parseTleFile(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const records = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const [name, line1, line2] = [lines[i], lines[i + 1], lines[i + 2]];
    // Defensive: a valid pair must start with "1 " and "2 ".
    if (line1?.startsWith("1 ") && line2?.startsWith("2 ")) {
      records.push({ name: name.trim(), line1, line2 });
    }
  }
  return records;
}

/**
 * Compile a TLE into a reusable SGP4 record. Compilation is relatively
 * expensive — do it ONCE per satellite and cache the result; propagation
 * against the cached satrec is then cheap enough to run every animation tick.
 *
 * @param {string} tleLine1
 * @param {string} tleLine2
 * @returns {import('satellite.js').SatRec}
 */
export function tleToSatrec(tleLine1, tleLine2) {
  return twoline2satrec(tleLine1, tleLine2);
}

/* ---------------------------------------------------------------------------
 * Propagation
 * ------------------------------------------------------------------------- */

/**
 * Propagate a satrec to `date` and return its ECF position + geodetic ground
 * track. Returns null when SGP4 fails (decayed satellite, corrupt TLE) so
 * callers can simply filter the satellite out instead of crashing the tick.
 *
 * @param {import('satellite.js').SatRec} satrec
 * @param {Date} date
 */
export function propagateToDate(satrec, date) {
  let eci;
  try {
    eci = propagate(satrec, date);
  } catch {
    return null;
  }
  // satellite.js signals failure with a falsy/boolean position.
  if (!eci || !eci.position || typeof eci.position === "boolean") return null;

  // GMST converts the inertial (ECI) vector into the Earth-fixed (ECF) frame.
  const gmst = gstime(date);
  const positionEcf = eciToEcf(eci.position, gmst);
  const geodetic = eciToGeodetic(eci.position, gmst);

  return {
    /** ECF position in km — feed this to look-angle math. */
    positionEcf,
    /** Sub-satellite point + orbital height (the "ground track"). */
    latitude: geodetic.latitude * RAD2DEG,
    longitude: geodetic.longitude * RAD2DEG,
    heightKm: geodetic.height,
  };
}

/* ---------------------------------------------------------------------------
 * Observer geometry — the heart of the "zenith" concept
 * ------------------------------------------------------------------------- */

/**
 * THE core function of Project Zenith.
 *
 * Given raw TLE data and an observer's geographic coordinates, compute where
 * the satellite appears in that observer's LOCAL SKY right now:
 *
 *   - `azimuth`   compass bearing in degrees (0 = N, 90 = E, 180 = S, 270 = W)
 *   - `altitude`  elevation above the horizon in degrees (90 = at zenith)
 *
 * plus supporting telemetry (slant range, ground track, zenith offset).
 *
 * @param {string} tleLine1                       First line of the TLE.
 * @param {string} tleLine2                       Second line of the TLE.
 * @param {{ latitude: number, longitude: number, heightM?: number }} observer
 *        Observer position in DEGREES; heightM is meters above sea level.
 * @param {Date} [date=new Date()]                Timestamp to evaluate at.
 * @returns {null | {
 *   azimuth: number,
 *   altitude: number,
 *   rangeKm: number,
 *   latitude: number,
 *   longitude: number,
 *   heightKm: number,
 *   degreesFromZenith: number,
 *   aboveHorizon: boolean
 * }}
 */
export function getAltitudeAzimuth(tleLine1, tleLine2, observer, date = new Date()) {
  const satrec = tleToSatrec(tleLine1, tleLine2);
  return getLookAngles(satrec, observer, date);
}

/**
 * Same as getAltitudeAzimuth, but takes a PRE-COMPILED satrec. Use this in
 * real-time loops: compile once with tleToSatrec(), then call this per tick.
 *
 * @param {import('satellite.js').SatRec} satrec
 * @param {{ latitude: number, longitude: number, heightM?: number }} observer
 * @param {Date} [date=new Date()]
 */
export function getLookAngles(satrec, observer, date = new Date()) {
  const state = propagateToDate(satrec, date);
  if (!state) return null;

  // satellite.js expects the observer in RADIANS with height in KILOMETERS.
  const observerGd = {
    latitude: observer.latitude * DEG2RAD,
    longitude: observer.longitude * DEG2RAD,
    height: (observer.heightM ?? 0) / 1000,
  };

  // Topocentric transform: where is the satellite in the observer's sky?
  const look = ecfToLookAngles(observerGd, state.positionEcf);

  const altitude = look.elevation * RAD2DEG;
  return {
    azimuth: wrap360(look.azimuth * RAD2DEG),
    altitude,
    /** Slant range: straight-line distance observer -> satellite, in km. */
    rangeKm: look.rangeSat,
    // Ground track (handy for plotting the dot on the 3D globe).
    latitude: state.latitude,
    longitude: state.longitude,
    heightKm: state.heightKm,
    /** 0° means the satellite is EXACTLY at the observer's zenith. */
    degreesFromZenith: 90 - altitude,
    /** Below 0° altitude the satellite is under the horizon (not visible). */
    aboveHorizon: altitude > 0,
  };
}

/**
 * Compass helper for the UI: 247.3° -> "WSW".
 * @param {number} azimuthDeg
 */
export function azimuthToCompass(azimuthDeg) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(wrap360(azimuthDeg) / 22.5) % 16];
}

/* ---------------------------------------------------------------------------
 * Orbital characterization — derived from the compiled satrec
 * ------------------------------------------------------------------------- */

/** Earth gravitational parameter, km^3/s^2 (WGS-72, matches SGP4). */
const MU_EARTH = 398600.8;
/** Earth equatorial radius, km. */
const EARTH_RADIUS_KM = 6378.137;

/**
 * Derive human-readable orbital parameters from a compiled satrec.
 * Used by the API route (so clients get metadata for free) and by the
 * satellite detail modal.
 *
 * @param {import('satellite.js').SatRec} satrec
 * @returns {{ periodMin: number, inclinationDeg: number, eccentricity: number,
 *             apogeeKm: number, perigeeKm: number, semiMajorAxisKm: number }}
 */
export function getOrbitalParameters(satrec) {
  // satrec.no = mean motion in radians/minute.
  const meanMotionRadPerSec = satrec.no / 60;
  // Kepler's third law: n^2 * a^3 = mu  ->  a = (mu / n^2)^(1/3)
  const semiMajorAxisKm = Math.cbrt(MU_EARTH / (meanMotionRadPerSec * meanMotionRadPerSec));
  const e = satrec.ecco;

  return {
    periodMin: (2 * Math.PI) / satrec.no,
    inclinationDeg: satrec.inclo * RAD2DEG,
    eccentricity: e,
    apogeeKm: semiMajorAxisKm * (1 + e) - EARTH_RADIUS_KM,
    perigeeKm: semiMajorAxisKm * (1 - e) - EARTH_RADIUS_KM,
    semiMajorAxisKm,
  };
}

/* ---------------------------------------------------------------------------
 * Pass prediction — "when does it fly over ME?"
 * ------------------------------------------------------------------------- */

/**
 * Predict upcoming visible passes of a satellite over an observer by scanning
 * forward in time and detecting horizon crossings above `minElevation`.
 *
 * Cost: (hours * 3600 / stepSeconds) propagations — the 24 h / 30 s default
 * is ~2,900 SGP4 calls ≈ tens of milliseconds. Run it on demand (modal open),
 * never inside the per-second tick.
 *
 * @param {import('satellite.js').SatRec} satrec
 * @param {{ latitude: number, longitude: number, heightM?: number }} observer
 * @param {{ startTime?: Date, hours?: number, stepSeconds?: number,
 *           minElevation?: number, maxPasses?: number }} [options]
 * @returns {Array<{ start: Date, end: Date, startAzimuth: number,
 *                   endAzimuth: number, maxAltitude: number,
 *                   maxAltitudeTime: Date, continuous: boolean }>}
 */
export function predictPasses(satrec, observer, options = {}) {
  const {
    startTime = new Date(),
    hours = 24,
    stepSeconds = 30,
    minElevation = 10, // below ~10° most passes are lost to buildings/haze
    maxPasses = 3,
  } = options;

  const passes = [];
  let current = null;

  for (let t = 0; t <= hours * 3600; t += stepSeconds) {
    const date = new Date(startTime.getTime() + t * 1000);
    const look = getLookAngles(satrec, observer, date);
    if (!look) continue;

    if (look.altitude >= minElevation) {
      if (!current) {
        current = {
          start: date,
          end: date,
          startAzimuth: look.azimuth,
          endAzimuth: look.azimuth,
          maxAltitude: look.altitude,
          maxAltitudeTime: date,
          continuous: false,
        };
      }
      current.end = date;
      current.endAzimuth = look.azimuth;
      if (look.altitude > current.maxAltitude) {
        current.maxAltitude = look.altitude;
        current.maxAltitudeTime = date;
      }
    } else if (current) {
      passes.push(current);
      current = null;
      if (passes.length >= maxPasses) return passes;
    }
  }

  // Still "in pass" at scan end: either a GEO bird that never sets (visible
  // the entire window -> continuous) or a pass clipped by the horizon of the
  // scan itself. Either way, report what we know.
  if (current) {
    current.continuous = current.end.getTime() - current.start.getTime() >= hours * 3600 * 1000 - stepSeconds * 1000;
    passes.push(current);
  }
  return passes;
}

/* ---------------------------------------------------------------------------
 * Ground track sampling — the orbit trail drawn on the 3D globe
 * ------------------------------------------------------------------------- */

/**
 * Sample one full orbit (centered on `centerDate`) as a series of geodetic
 * points, ready to be mapped to Cesium Cartesian3 positions.
 *
 * @param {import('satellite.js').SatRec} satrec
 * @param {Date} centerDate
 * @param {number} periodMin   Orbital period (from getOrbitalParameters).
 * @param {number} [samples=240]
 * @returns {Array<{ latitude: number, longitude: number, heightKm: number }>}
 */
export function computeGroundTrack(satrec, centerDate, periodMin, samples = 240) {
  const points = [];
  const halfSpanMs = (periodMin * 60 * 1000) / 2;
  const stepMs = (periodMin * 60 * 1000) / samples;

  for (let i = 0; i <= samples; i++) {
    const date = new Date(centerDate.getTime() - halfSpanMs + i * stepMs);
    const state = propagateToDate(satrec, date);
    if (!state) continue;
    points.push({
      latitude: state.latitude,
      longitude: state.longitude,
      heightKm: state.heightKm,
    });
  }
  return points;
}
