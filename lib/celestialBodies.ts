// =============================================================================
// lib/celestialBodies.ts — solar-system bodies via astronomy-engine
// =============================================================================
// Satellites come from TLEs; planets, the Sun and the Moon come from a local
// ephemeris (astronomy-engine, ±1 arcminute accuracy) — no network calls.
// Everything is normalized to the SAME sky coordinates as the satellites
// (azimuth / altitude / degrees-from-zenith) so the rest of the app treats
// "Mars" and "ISS" identically.
// =============================================================================

import {
  Body,
  Constellation,
  Equator,
  Horizon,
  Illumination,
  Observer as AstroObserver,
  SearchRiseSet,
  SiderealTime,
} from "astronomy-engine";
import type { Observer } from "@/lib/layers";

/** km per astronomical unit. */
const AU_KM = 149_597_870.7;

/** Bodies tracked by the "Solar System" layer (Earth excluded for reasons). */
export const SOLAR_SYSTEM_BODIES: { body: Body; name: string }[] = [
  { body: Body.Sun, name: "Sun" },
  { body: Body.Moon, name: "Moon" },
  { body: Body.Mercury, name: "Mercury" },
  { body: Body.Venus, name: "Venus" },
  { body: Body.Mars, name: "Mars" },
  { body: Body.Jupiter, name: "Jupiter" },
  { body: Body.Saturn, name: "Saturn" },
  { body: Body.Uranus, name: "Uranus" },
  { body: Body.Neptune, name: "Neptune" },
];

function toAstroObserver(observer: Observer): AstroObserver {
  return new AstroObserver(observer.latitude, observer.longitude, observer.heightM ?? 0);
}

/**
 * Where is this body in the observer's sky right now — and what point on
 * Earth is it directly above?
 */
export function getBodySky(body: Body, observer: Observer, date: Date) {
  const astroObs = toAstroObserver(observer);

  // Topocentric equatorial coordinates of-date (corrected for parallax —
  // matters for the Moon, where the geocentric error is up to ~1°).
  const equ = Equator(body, date, astroObs, true, true);
  // Convert RA/Dec to the observer's local horizon (with refraction).
  const hor = Horizon(date, astroObs, equ.ra, equ.dec, "normal");

  // Sub-point: the lat/lon where this body is at the zenith RIGHT NOW.
  //   latitude  = declination
  //   longitude = RA - Greenwich sidereal time (hour angle at Greenwich)
  const gastHours = SiderealTime(date);
  let subLon = (equ.ra - gastHours) * 15; // hours -> degrees
  subLon = ((subLon + 540) % 360) - 180; // normalize to [-180, 180)

  const altitude = hor.altitude;
  return {
    azimuth: hor.azimuth,
    altitude,
    rangeKm: equ.dist * AU_KM,
    latitude: equ.dec,
    longitude: subLon,
    heightKm: equ.dist * AU_KM, // true distance; the globe caps for plotting
    degreesFromZenith: 90 - altitude,
    aboveHorizon: altitude > 0,
  };
}

/** Extra facts for the detail modal — computed on demand, not per tick. */
export function getBodyDetails(body: Body, observer: Observer, date: Date) {
  const astroObs = toAstroObserver(observer);
  const equ = Equator(body, date, astroObs, true, true);

  // Constellation lookup expects J2000 coordinates; of-date is within ~0.3°
  // for the 2026 epoch, far inside constellation-boundary tolerance.
  const constellation = Constellation(equ.ra, equ.dec);

  // Visual magnitude (lower = brighter; Sun ≈ -26.7, Venus ≈ -4).
  let magnitude: number | null = null;
  try {
    magnitude = Illumination(body, date).mag;
  } catch {
    magnitude = null; // not defined for all bodies
  }

  // Next rise/set: scan up to 2 days ahead.
  const rise = SearchRiseSet(body, astroObs, +1, date, 2);
  const set = SearchRiseSet(body, astroObs, -1, date, 2);

  return {
    constellation: constellation.name,
    distanceAu: equ.dist,
    magnitude,
    nextRise: rise ? rise.date : null,
    nextSet: set ? set.date : null,
  };
}
