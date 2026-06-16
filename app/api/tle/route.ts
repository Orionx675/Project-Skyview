// =============================================================================
// app/api/tle/route.ts — TLE pipeline: CelesTrak -> satellite.js -> client
// =============================================================================
// GET /api/tle?group=stations&format=json&limit=15
//
// This route does real work, not just proxying:
//   1. FETCH    raw TLEs from CelesTrak (shared 2 h Data Cache — one upstream
//               hit per group per window, across ALL visitors).
//   2. PARSE    each TLE with satellite.js (twoline2satrec) ON THE SERVER and
//               reject records SGP4 itself flags as bad (satrec.error !== 0)
//               — corrupt or decayed elements never reach a client.
//   3. ENRICH   each record with derived orbital metadata (period,
//               inclination, apogee/perigee) so the UI gets it for free.
//
// format=tle returns the raw upstream text (debugging / interop).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { DATA_LAYERS } from "@/lib/layers";
import { getOrbitalParameters, parseTleFile, tleToSatrec } from "@/utils/orbitalMath";

const CELESTRAK_GP_URL = "https://celestrak.org/NORAD/elements/gp.php";
const MAX_LIMIT = 200; // hard server-side cap, whatever the client asks for

// Allow-list straight from the layer registry — this can't be an open proxy.
const ALLOWED_GROUPS = new Set(
  DATA_LAYERS.map((l) => l.celestrakGroup).filter((g): g is string => g !== null)
);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const group = params.get("group") ?? "stations";
  const format = params.get("format") ?? "json";
  const limit = Math.min(Math.max(Number(params.get("limit")) || MAX_LIMIT, 1), MAX_LIMIT);

  if (!ALLOWED_GROUPS.has(group)) {
    return NextResponse.json(
      { error: `Unknown TLE group '${group}'.`, allowed: [...ALLOWED_GROUPS] },
      { status: 400 }
    );
  }

  // ---- 1. FETCH (through the Next.js Data Cache) --------------------------
  let tleText: string;
  try {
    const upstream = await fetch(`${CELESTRAK_GP_URL}?GROUP=${group}&FORMAT=tle`, {
      next: { revalidate: 7200 },
      headers: { "User-Agent": "ProjectZenith/2.0 (AstralWeb Innovate 2026)" },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `CelesTrak responded ${upstream.status}` }, { status: 502 });
    }
    tleText = await upstream.text();
  } catch {
    return NextResponse.json({ error: "Failed to reach CelesTrak." }, { status: 502 });
  }

  if (format === "tle") {
    return new NextResponse(tleText, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=600, stale-while-revalidate=7200",
      },
    });
  }

  // ---- 2. PARSE + 3. ENRICH (satellite.js, server-side) -------------------
  // Slice BEFORE compiling: no point paying SGP4 init for records we drop.
  const satellites = parseTleFile(tleText)
    .slice(0, limit)
    .map((tle) => {
      const satrec = tleToSatrec(tle.line1, tle.line2);
      // satrec.error is SGP4's own validity verdict (0 = clean).
      if (!satrec || satrec.error !== 0) return null;

      const orbit = getOrbitalParameters(satrec);
      return {
        name: tle.name,
        noradId: tle.line1.slice(2, 7).trim(),
        line1: tle.line1,
        line2: tle.line2,
        periodMin: round(orbit.periodMin, 2),
        inclinationDeg: round(orbit.inclinationDeg, 2),
        eccentricity: round(orbit.eccentricity, 5),
        apogeeKm: round(orbit.apogeeKm, 1),
        perigeeKm: round(orbit.perigeeKm, 1),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return NextResponse.json(
    { group, count: satellites.length, fetchedAt: new Date().toISOString(), satellites },
    { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=7200" } }
  );
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
