// =============================================================================
// app/api/weather/route.ts — Open-Meteo hourly forecast proxy
// =============================================================================
// GET /api/weather?lat=28.61&lon=77.21
//
// Feeds the Clear Sky stargazing planner. Open-Meteo is free and key-less, but
// we proxy it server-side for the same reasons as /api/tle:
//   · CACHING — forecasts refresh slowly; a 30-min shared Data Cache means one
//     upstream hit per ~rounded coordinate per window, across all visitors.
//   · NORMALIZATION — we hand the client a tidy `{ hours: [...] }` array of
//     UTC-timestamped samples instead of Open-Meteo's parallel-arrays shape.
//   · PRIVACY — coordinates are rounded to 2 dp (~1 km) before they leave us.
//
// We request `timeformat=unixtime` + `timezone=GMT` so every timestamp is an
// unambiguous UTC unix second — no locale/offset parsing on the client.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Invalid or missing lat/lon." }, { status: 400 });
  }

  // Round to ~1 km: better cache hit-rate and a little location privacy.
  const rlat = Math.round(lat * 100) / 100;
  const rlon = Math.round(lon * 100) / 100;

  const url =
    `${OPEN_METEO_URL}?latitude=${rlat}&longitude=${rlon}` +
    `&hourly=cloud_cover,precipitation_probability` +
    `&forecast_days=2&timeformat=unixtime&timezone=GMT`;

  try {
    const upstream = await fetch(url, { next: { revalidate: 1800 } });
    if (!upstream.ok) {
      return NextResponse.json({ error: `Open-Meteo responded ${upstream.status}` }, { status: 502 });
    }

    const data = (await upstream.json()) as {
      hourly?: {
        time?: number[];
        cloud_cover?: (number | null)[];
        precipitation_probability?: (number | null)[];
      };
    };

    const time = data.hourly?.time ?? [];
    const cloud = data.hourly?.cloud_cover ?? [];
    const precip = data.hourly?.precipitation_probability ?? [];

    // Normalize to one object per hour; drop samples with no cloud reading.
    const hours = time
      .map((timestamp, i) => ({
        timestamp, // unix seconds, UTC
        cloudCover: cloud[i] ?? null,
        precipProbability: precip[i] ?? null,
      }))
      .filter((h): h is { timestamp: number; cloudCover: number; precipProbability: number | null } =>
        h.cloudCover !== null
      );

    return NextResponse.json(
      { latitude: rlat, longitude: rlon, fetchedAt: new Date().toISOString(), hours },
      { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=1800" } }
    );
  } catch {
    return NextResponse.json({ error: "Failed to reach Open-Meteo." }, { status: 502 });
  }
}
