// =============================================================================
// lib/clearSky.ts — "Golden Window" cross-referencing logic (pure)
// =============================================================================
// A GOLDEN WINDOW is a high-visibility satellite pass (peak altitude > 10°)
// that coincides with clear skies (< 20% cloud cover). This module takes the
// visible passes our SGP4 propagator already produces and the hourly weather
// from /api/weather, and grades each pass into golden / good / poor — with
// encouraging, plain-language micro-copy for casual stargazers.
//
// A stargazing nuance the raw spec doesn't cover: a *clear-sky daytime* pass
// is still hard to see. We keep "golden" = clear skies (per the definition),
// but compute the Sun's altitude at pass time (astronomy-engine) to tune the
// wording and to rank truly-dark windows first.
// =============================================================================

import { Body } from "astronomy-engine";
import { getBodySky } from "@/lib/celestialBodies";
import type { Observer } from "@/lib/layers";

/** One normalized hourly weather sample (from /api/weather). */
export interface WeatherHour {
  timestamp: number; // unix seconds, UTC
  cloudCover: number; // %
  precipProbability: number | null; // %
}

/** A high-visibility pass to be graded (sourced from predictPasses). */
export interface VisiblePass {
  objectId: string;
  name: string;
  color: string;
  start: Date;
  peak: Date;
  end: Date;
  maxAltitude: number;
  startAzimuth: number;
  endAzimuth: number;
}

export type SkyQuality = "golden" | "good" | "poor";

export interface SkyWindow extends VisiblePass {
  cloudCover: number | null;
  precipProbability: number | null;
  sunAltitude: number; // Sun's altitude (deg) at peak — negative = night
  isDark: boolean; // Sun below civil-twilight threshold
  quality: SkyQuality;
  message: string; // friendly micro-copy
}

/** Cloud-cover thresholds (%) that define the quality tiers. */
export const GOLDEN_CLOUD_THRESHOLD = 20;
const GOOD_CLOUD_THRESHOLD = 50;
/** Sun altitude (deg) below which the sky is dark enough for satellites. */
const DARK_SUN_ALTITUDE = -6; // end of civil twilight
/** Passes peaking within this window are treated as the same event. */
const DEDUPE_BUCKET_MS = 3 * 60 * 1000;

/**
 * Linearly interpolate cloud cover (and precipitation chance) at any instant
 * between the bracketing hourly samples. Clamps to the ends of the forecast.
 */
export function cloudCoverAt(
  weather: WeatherHour[],
  date: Date
): { cloudCover: number; precip: number | null } | null {
  if (weather.length === 0) return null;
  const t = date.getTime() / 1000;

  if (t <= weather[0].timestamp) {
    return { cloudCover: weather[0].cloudCover, precip: weather[0].precipProbability };
  }
  const last = weather[weather.length - 1];
  if (t >= last.timestamp) {
    return { cloudCover: last.cloudCover, precip: last.precipProbability };
  }

  for (let i = 0; i < weather.length - 1; i++) {
    const a = weather[i];
    const b = weather[i + 1];
    if (t >= a.timestamp && t <= b.timestamp) {
      const f = (t - a.timestamp) / (b.timestamp - a.timestamp);
      const cloudCover = a.cloudCover + (b.cloudCover - a.cloudCover) * f;
      const precip =
        a.precipProbability != null && b.precipProbability != null
          ? a.precipProbability + (b.precipProbability - a.precipProbability) * f
          : (a.precipProbability ?? b.precipProbability);
      return { cloudCover, precip };
    }
  }
  return null;
}

function gradeQuality(cloud: number | null): SkyQuality {
  if (cloud == null) return "good"; // unknown weather — don't over-promise
  if (cloud < GOLDEN_CLOUD_THRESHOLD) return "golden";
  if (cloud < GOOD_CLOUD_THRESHOLD) return "good";
  return "poor";
}

/** Encouraging, plain-language summary for one window. */
function buildMessage(w: SkyWindow): string {
  const time = w.peak.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const alt = Math.round(w.maxAltitude);
  const rain =
    w.precipProbability != null && w.precipProbability >= 30
      ? ` Rain is possible (${w.precipProbability}%).`
      : "";

  if (w.quality === "golden") {
    return w.isDark
      ? `Perfect conditions! ${w.name} will be brightly visible against clear, dark skies at ${time}, climbing to ${alt}° above the horizon.${rain}`
      : `${w.name} sails over at ${time} under clear skies (peak ${alt}°), but daylight will likely wash it out — clear nights are the ones to catch.${rain}`;
  }
  if (w.quality === "good") {
    return `${w.name} passes at ${time} reaching ${alt}°, with around ${w.cloudCover}% cloud cover — you may catch it between the clouds.${rain}`;
  }
  return `${w.name} is overhead at ${time}, but heavy cloud (~${w.cloudCover}%) will likely hide it from view.${rain}`;
}

/**
 * Grade every pass against the weather, collapse near-duplicate passes (the
 * ISS and its docked modules share an orbit and peak together), and return a
 * chronological forecast timeline.
 */
export function computeSkyWindows(
  passes: VisiblePass[],
  weather: WeatherHour[],
  observer: Observer
): SkyWindow[] {
  const graded: SkyWindow[] = passes.map((pass) => {
    const wx = cloudCoverAt(weather, pass.peak);
    const cloudCover = wx ? Math.round(wx.cloudCover) : null;
    const precipProbability = wx && wx.precip != null ? Math.round(wx.precip) : null;

    const sun = getBodySky(Body.Sun, observer, pass.peak);
    const sunAltitude = sun ? sun.altitude : 0;

    const w: SkyWindow = {
      ...pass,
      cloudCover,
      precipProbability,
      sunAltitude,
      isDark: sunAltitude < DARK_SUN_ALTITUDE,
      quality: gradeQuality(cloudCover),
      message: "",
    };
    w.message = buildMessage(w);
    return w;
  });

  // Collapse passes that peak within the same few-minute bucket, keeping the
  // highest-altitude one — so the ISS doesn't appear five times (once per
  // docked module sharing its orbit).
  const byBucket = new Map<number, SkyWindow>();
  for (const w of graded) {
    const bucket = Math.round(w.peak.getTime() / DEDUPE_BUCKET_MS);
    const existing = byBucket.get(bucket);
    if (!existing || w.maxAltitude > existing.maxAltitude) byBucket.set(bucket, w);
  }

  return [...byBucket.values()].sort((a, b) => a.peak.getTime() - b.peak.getTime());
}

/** Count of true stargazing windows: clear AND dark. */
export function goldenDarkWindows(windows: SkyWindow[]): SkyWindow[] {
  return windows.filter((w) => w.quality === "golden" && w.isDark);
}

const QUALITY_WEIGHT: Record<SkyQuality, number> = { golden: 3, good: 2, poor: 1 };

/**
 * A 24-hour scan of every bright object yields far too many passes for a
 * casual planner (and the stations group is full of unglamorous debris). Pick
 * the most WATCHABLE windows — clear, dark and high — then return that short
 * list in chronological order so it still reads as a timeline.
 */
export function selectBestWindows(windows: SkyWindow[], limit = 8): SkyWindow[] {
  const score = (w: SkyWindow) =>
    QUALITY_WEIGHT[w.quality] * 1000 + (w.isDark ? 500 : 0) + w.maxAltitude;
  return [...windows]
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)
    .sort((a, b) => a.peak.getTime() - b.peak.getTime());
}
