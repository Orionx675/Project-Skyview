// =============================================================================
// app/api/iss/route.ts — OpenNotify cross-check for the ISS
// =============================================================================
// Independent second source: OpenNotify publishes the ISS position from its
// own pipeline. The detail modal compares it against OUR SGP4-propagated
// position and shows the delta — a live, visible proof of accuracy that
// doubles as great hackathon-demo material.
//
// (Proxied server-side because OpenNotify is plain http://, which a browser
// on an https page would block as mixed content.)
// =============================================================================

import { NextResponse } from "next/server";

const OPEN_NOTIFY_URL = "http://api.open-notify.org/iss-now.json";

export async function GET() {
  try {
    const upstream = await fetch(OPEN_NOTIFY_URL, {
      // Position changes every second — cache only briefly, and per-server.
      next: { revalidate: 5 },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `OpenNotify responded ${upstream.status}` }, { status: 502 });
    }

    const data = (await upstream.json()) as {
      iss_position: { latitude: string; longitude: string };
      timestamp: number;
    };

    return NextResponse.json(
      {
        latitude: Number(data.iss_position.latitude),
        longitude: Number(data.iss_position.longitude),
        timestamp: data.timestamp, // unix seconds, OpenNotify's own clock
        source: "open-notify.org",
      },
      { headers: { "Cache-Control": "public, max-age=5" } }
    );
  } catch {
    return NextResponse.json({ error: "Failed to reach OpenNotify." }, { status: 502 });
  }
}
