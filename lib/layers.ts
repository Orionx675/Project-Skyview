// =============================================================================
// lib/layers.ts — registry of toggleable data layers + shared tracking types
// =============================================================================
// Round 2: every layer is REAL. Satellite layers stream TLEs from CelesTrak
// through /api/tle; the Solar System layer is computed locally with
// astronomy-engine (no API needed — full ephemeris math in ~100 KB).
// =============================================================================

export type ObjectKind = "satellite" | "planet";

export interface DataLayer {
  /** Stable id used as React key and state key. */
  id: string;
  /** Human-readable label shown in the sidebar. */
  label: string;
  /** One-line description under the label. */
  description: string;
  /** What kind of objects this layer produces (drives catalog loading). */
  kind: ObjectKind;
  /** CelesTrak GROUP query value (satellite layers only). */
  celestrakGroup: string | null;
  /** Accent color (hex) used for the sidebar dot and the globe markers. */
  color: string;
  /** Cap on objects tracked — keeps per-frame propagation cheap. */
  maxObjects: number;
  /** Whether the layer starts enabled. */
  defaultEnabled: boolean;
}

export const DATA_LAYERS: DataLayer[] = [
  {
    id: "stations",
    label: "Space Stations",
    description: "ISS (ZARYA), Tiangong & crewed platforms",
    kind: "satellite",
    celestrakGroup: "stations",
    color: "#2dd4ff",
    maxObjects: 15,
    defaultEnabled: true,
  },
  {
    id: "brightest",
    label: "Brightest Satellites",
    description: "100 brightest objects (visual magnitude)",
    kind: "satellite",
    celestrakGroup: "visual",
    color: "#a78bfa",
    maxObjects: 60,
    defaultEnabled: false,
  },
  {
    id: "starlink",
    label: "Starlink (sample)",
    description: "Live sample of the Starlink shell",
    kind: "satellite",
    celestrakGroup: "starlink",
    color: "#34d399",
    maxObjects: 40,
    defaultEnabled: false,
  },
  {
    id: "gps",
    label: "GPS Constellation",
    description: "Operational GPS (MEO, ~20,200 km)",
    kind: "satellite",
    celestrakGroup: "gps-ops",
    color: "#fbbf24",
    maxObjects: 32,
    defaultEnabled: false,
  },
  {
    id: "solar-system",
    label: "Solar System",
    description: "Sun, Moon & planets via local ephemeris",
    kind: "planet",
    celestrakGroup: null,
    color: "#f472b6",
    maxObjects: 9,
    defaultEnabled: true,
  },
];

/**
 * One tracked object on a given tick: a satellite OR a solar-system body,
 * normalized to the same shape so the UI never needs to branch.
 */
export interface TrackedObject {
  id: string;
  name: string;
  layerId: string;
  color: string;
  kind: ObjectKind;
  /** Sub-point: the lat/lon the object is directly above right now. */
  latitude: number;
  longitude: number;
  /** Orbital height above the ellipsoid (satellites), km. */
  heightKm: number;
  /** Observer-relative sky position. */
  azimuth: number;
  altitude: number;
  /** Slant range observer -> object, km (planets: true distance). */
  rangeKm: number;
  degreesFromZenith: number;
  aboveHorizon: boolean;
}

export interface Observer {
  latitude: number;
  longitude: number;
  heightM?: number;
  label?: string;
}
