// =============================================================================
// lib/fovMath.ts — sensor optics + sky-frame geometry (pure, framework-free)
// =============================================================================
// THE OPTICS
// A pinhole camera's angular field of view follows from similar triangles:
//
//     FOV = 2 · atan( sensorSize / (2 · focalLength) )
//
// Sony IMX890 (8.19 mm × 6.14 mm) behind a 50 mm lens:
//     horizontal: 2·atan(8.19 / 100) ≈ 9.37°
//     vertical:   2·atan(6.14 / 100) ≈ 7.03°
//
// THE FRAME GEOMETRY
// Everything here works in the observer's local ENU frame (x=east, y=north,
// z=up). A camera aimed at (azimuth, altitude) with zero roll defines an
// orthonormal basis {dir, right, up}. A pixel at normalized image coordinates
// (u, v) ∈ [-1, 1]² corresponds to the RAY
//
//     ray(u, v) = normalize( dir + u·tan(hFov/2)·right + v·tan(vFov/2)·up )
//
// — the exact pinhole projection. Sampling rays along the image border gives
// the FOV rectangle as it truly lies on the celestial sphere (its edges bow
// slightly at wide angles, exactly like a real wide-angle frame). The same
// math inverted (frameCoords) tests whether a sky direction lands inside the
// sensor — that's how the transit window is computed.
// =============================================================================

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Orthonormal camera basis in ENU space (zero roll: `up` leans to zenith). */
export interface FrameBasis {
  dir: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface SensorPreset {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

/** Default first: the brief's Sony IMX890 (typical flagship-phone main sensor). */
export const SENSOR_PRESETS: SensorPreset[] = [
  { id: "imx890", label: "Sony IMX890 · 1/1.56″", widthMm: 8.19, heightMm: 6.14 },
  { id: "one-inch", label: "1″ type", widthMm: 13.2, heightMm: 8.8 },
  { id: "m43", label: "Micro Four Thirds", widthMm: 17.3, heightMm: 13.0 },
  { id: "apsc", label: "APS-C", widthMm: 23.5, heightMm: 15.6 },
  { id: "fullframe", label: "Full frame", widthMm: 36.0, heightMm: 24.0 },
];

export const DEFAULT_SENSOR = SENSOR_PRESETS[0];
export const DEFAULT_FOCAL_LENGTH_MM = 50;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Angular field of view (degrees) for one sensor dimension at a focal length. */
export function fovDegrees(sensorSizeMm: number, focalLengthMm: number): number {
  return 2 * Math.atan(sensorSizeMm / (2 * focalLengthMm)) * RAD2DEG;
}

/** Half-angle tangents — the native currency of the projection math below. */
export function tanLimits(sensor: SensorPreset, focalLengthMm: number) {
  return {
    tanH: sensor.widthMm / (2 * focalLengthMm),
    tanV: sensor.heightMm / (2 * focalLengthMm),
  };
}

/**
 * Limiting (faintest visible) magnitude for a given sensor + focal length.
 * A long lens narrows the field and magnifies, revealing dimmer stars — so as
 * the field shrinks the limit climbs. Anchored at ~3.0 for the widest field
 * (≈38° at 12 mm) and rising ~2.5 mag per decade of field-of-view reduction.
 */
export function limitingMagnitude(sensor: SensorPreset, focalLengthMm: number): number {
  const fovH = fovDegrees(sensor.widthMm, focalLengthMm);
  const m = 3.0 + 2.5 * Math.log10(38 / Math.max(fovH, 0.05));
  return Math.max(2.5, Math.min(12, m));
}

/** Equatorial coordinates → unit Vec3 in the inertial frame (x → vernal
 *  equinox, z → north celestial pole). Cesium-free, for in-frame tests. */
export function equatorialUnitVec3(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return { x: cosDec * Math.cos(ra), y: cosDec * Math.sin(ra), z: Math.sin(dec) };
}

/* ----------------------------- tiny vec3 kit ----------------------------- */

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function normalize(v: Vec3): Vec3 {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/* ----------------------------- sky directions ---------------------------- */

/** Unit ENU vector for a sky direction (azimuth 0°=N, 90°=E; altitude up). */
export function enuDirection(azimuthDeg: number, altitudeDeg: number): Vec3 {
  const az = azimuthDeg * DEG2RAD;
  const alt = altitudeDeg * DEG2RAD;
  const c = Math.cos(alt);
  return { x: Math.sin(az) * c, y: Math.cos(az) * c, z: Math.sin(alt) };
}

/**
 * Zero-roll camera basis for an aim direction. `right` points toward
 * increasing azimuth, `up` toward increasing altitude. Near the zenith the
 * zenith reference degenerates — fall back to north so the basis stays sane.
 */
export function frameBasis(aimDir: Vec3): FrameBasis {
  const dir = normalize(aimDir);
  const zenith: Vec3 = { x: 0, y: 0, z: 1 };
  const reference = Math.abs(dot(dir, zenith)) > 0.999 ? { x: 0, y: 1, z: 0 } : zenith;
  const right = normalize(cross(dir, reference));
  const up = cross(right, dir); // already unit (right ⟂ dir, both unit)
  return { dir, right, up };
}

/** Pinhole ray for normalized image coords (u, v) ∈ [-1, 1]². */
export function frameRay(basis: FrameBasis, u: number, v: number, tanH: number, tanV: number): Vec3 {
  return normalize({
    x: basis.dir.x + u * tanH * basis.right.x + v * tanV * basis.up.x,
    y: basis.dir.y + u * tanH * basis.right.y + v * tanV * basis.up.y,
    z: basis.dir.z + u * tanH * basis.right.z + v * tanV * basis.up.z,
  });
}

/**
 * Inverse projection: where does a sky direction land on the image plane?
 * Returns tangent-space coordinates; the direction is inside the frame iff
 * `forward` and |x| ≤ tanH and |y| ≤ tanV.
 */
export function frameCoords(basis: FrameBasis, d: Vec3): { x: number; y: number; forward: boolean } {
  const f = dot(d, basis.dir);
  if (f <= 1e-9) return { x: Infinity, y: Infinity, forward: false };
  return { x: dot(d, basis.right) / f, y: dot(d, basis.up) / f, forward: true };
}

export function isInFrame(basis: FrameBasis, d: Vec3, tanH: number, tanV: number): boolean {
  const c = frameCoords(basis, d);
  return c.forward && Math.abs(c.x) <= tanH && Math.abs(c.y) <= tanV;
}

/* --------------------------- reticle geometry ---------------------------- */

/**
 * The FOV rectangle as a closed loop of unit directions, edges sampled so the
 * frame renders correctly on the sphere even at wide angles.
 */
export function reticleOutline(basis: FrameBasis, tanH: number, tanV: number, perEdge = 8): Vec3[] {
  // Walk the unit-square perimeter: (-1,-1) → (1,-1) → (1,1) → (-1,1) → close.
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const points: Vec3[] = [];
  for (let e = 0; e < 4; e++) {
    const [u0, v0] = corners[e];
    const [u1, v1] = corners[(e + 1) % 4];
    for (let s = 0; s < perEdge; s++) {
      const t = s / perEdge;
      points.push(frameRay(basis, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, tanH, tanV));
    }
  }
  points.push(points[0]); // close the loop
  return points;
}

/** Rule-of-thirds guides: two vertical + two horizontal sampled lines. */
export function thirdsGrid(basis: FrameBasis, tanH: number, tanV: number, perLine = 8): Vec3[][] {
  const lines: Vec3[][] = [];
  for (const u of [-1 / 3, 1 / 3]) {
    const line: Vec3[] = [];
    for (let s = 0; s <= perLine; s++) line.push(frameRay(basis, u, -1 + (2 * s) / perLine, tanH, tanV));
    lines.push(line);
  }
  for (const v of [-1 / 3, 1 / 3]) {
    const line: Vec3[] = [];
    for (let s = 0; s <= perLine; s++) line.push(frameRay(basis, -1 + (2 * s) / perLine, v, tanH, tanV));
    lines.push(line);
  }
  return lines;
}

/** Small center crosshair (±8% of the frame in each axis). */
export function crosshairLines(basis: FrameBasis, tanH: number, tanV: number): Vec3[][] {
  return [
    [frameRay(basis, -0.08, 0, tanH, tanV), frameRay(basis, 0.08, 0, tanH, tanV)],
    [frameRay(basis, 0, -0.08, tanH, tanV), frameRay(basis, 0, 0.08, tanH, tanV)],
  ];
}
