// =============================================================================
// lib/geocode.ts — reverse-geocoding types + helpers (shared client/server)
// =============================================================================
// Pure functions usable on both sides:
//   · formatPlaceName() condenses a Nominatim response into a friendly label
//     ("Western Ghats, India") — imported by the /api/geocode route.
//   · reverseGeocode() is the CLIENT helper; it calls our own /api/geocode
//     proxy (never Nominatim directly — see the route for why).
// =============================================================================

export interface GeocodeResult {
  /** Friendly label, or null if nothing named is here (open ocean, etc.). */
  name: string | null;
  /** True when the point is over unnamed water / Nominatim found nothing. */
  ocean: boolean;
  /** Full Nominatim display_name, for a secondary line if desired. */
  display?: string | null;
}

/** Subset of the Nominatim jsonv2 reverse response we read. */
export interface NominatimReverse {
  error?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
}

/**
 * Condense a Nominatim reverse result into a short "Place, Country" label.
 * Walks from the most specific useful component down to the country, matching
 * the region-level naming the planner wants at zoom≈10.
 */
export function formatPlaceName(data: NominatimReverse): string | null {
  const a = data.address ?? {};
  const country = a.country;
  const primary =
    data.name ||
    a.city ||
    a.town ||
    a.village ||
    a.suburb ||
    a.county ||
    a.state_district ||
    a.state ||
    a.region ||
    country ||
    null;

  if (primary && country && primary !== country) return `${primary}, ${country}`;
  if (primary) return primary;
  if (data.display_name) return data.display_name.split(",").slice(0, 2).join(", ").trim();
  return null;
}

/**
 * CLIENT-side reverse geocode. Hits our /api/geocode proxy (which talks to
 * Nominatim with a compliant User-Agent + caching). Throws on transport error.
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult> {
  const res = await fetch(`/api/geocode?lat=${latitude}&lon=${longitude}`);
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  return (await res.json()) as GeocodeResult;
}
