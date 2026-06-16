// =============================================================================
// app/api/geocode/route.ts — OpenStreetMap Nominatim reverse-geocode proxy
// =============================================================================
// GET /api/geocode?lat=15.3&lon=74.1  ->  { name, ocean, display }
//
// Why proxy instead of calling Nominatim from the browser?
//   · POLICY — Nominatim's usage policy requires an identifying User-Agent and
//     caps traffic at ~1 req/s. A browser can't set User-Agent, and direct
//     calls risk CORS + getting the public instance to block us.
//   · CACHING — place names are effectively static, so a 24 h shared Data
//     Cache (keyed on rounded coordinates) keeps us far under the rate limit.
//   · NORMALIZATION — we return a tidy { name, ocean } instead of the raw,
//     sprawling Nominatim payload.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { formatPlaceName, type NominatimReverse } from "@/lib/geocode";

const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Invalid or missing lat/lon." }, { status: 400 });
  }

  // Round to ~10 m: strong cache key, plenty precise for a place name.
  const rlat = Math.round(lat * 10000) / 10000;
  const rlon = Math.round(lon * 10000) / 10000;

  const url =
    `${NOMINATIM_REVERSE}?format=jsonv2&lat=${rlat}&lon=${rlon}` +
    `&zoom=10&accept-language=en`;

  try {
    const upstream = await fetch(url, {
      next: { revalidate: 86400 }, // names don't change — cache a day
      headers: {
        // Nominatim policy requires a descriptive UA with a contact.
        "User-Agent": "ProjectSkyView/1.0 (AstralWeb Innovate 2026; kaushik272007@gmail.com)",
        "Accept-Language": "en",
      },
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `Nominatim responded ${upstream.status}` }, { status: 502 });
    }

    const data = (await upstream.json()) as NominatimReverse;

    // Open ocean / unnamed: Nominatim returns { error: "Unable to geocode" }.
    if (data.error || (!data.display_name && !data.name)) {
      return NextResponse.json(
        { name: null, ocean: true, display: null },
        { headers: { "Cache-Control": "public, max-age=3600" } }
      );
    }

    return NextResponse.json(
      { name: formatPlaceName(data), ocean: false, display: data.display_name ?? null },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
    );
  } catch {
    return NextResponse.json({ error: "Failed to reach Nominatim." }, { status: 502 });
  }
}
