// =============================================================================
// lib/auroraOval.ts — procedural auroral-oval rings on the Cesium globe
// =============================================================================
// Maps live geomagnetic activity (the planetary Kp index) onto the 3D globe as
// glowing green rings around the geomagnetic poles, giving high-latitude users
// instant "can I see the aurora tonight?" context.
//
// The auroral oval is a band centred on each geomagnetic pole. Its equatorward
// edge marches toward the equator as Kp rises (stronger storms push the aurora
// to lower latitudes), so the ring's angular radius GROWS with Kp. We draw the
// band as a closed Cesium CorridorGeometry (a fixed-width ribbon following a
// small circle), rendered as a translucent green Primitive.
//
// This is a plain imperative module — no React. A thin <AuroraLayer> component
// owns its lifecycle and calls update()/destroy(). Every primitive we add is
// tracked and removed on update/teardown, and every scene access is guarded by
// viewer.isDestroyed() so a globe torn down mid-flight never throws.
// =============================================================================

import type { Viewer, Primitive } from "cesium";

type CesiumModule = typeof import("cesium");

/**
 * Geomagnetic pole positions (approximate, epoch ~2025). The auroral oval is
 * roughly circular about these, not the geographic poles.
 */
const GEOMAGNETIC_POLES = [
  { lat: 80.65, lon: -72.68 }, // North
  { lat: -80.65, lon: 107.32 }, // South
] as const;

/**
 * Equatorward boundary of the auroral oval, in geomagnetic latitude, as a
 * function of Kp. Empirical fit: the boundary sits near 67° in quiet times and
 * drops ~2° of latitude per Kp step, exposing ever-lower latitudes during
 * storms. Clamped so the ring stays physically sane across Kp 0–9.
 */
export function auroralBoundaryLatitude(kp: number): number {
  return Math.max(45, Math.min(70, 67 - 2 * kp));
}

/**
 * Sample a small circle of given angular radius about a centre point on the
 * sphere, returning Cartesian3 positions at ground level — the corridor's
 * centreline. Uses the standard "destination point given bearing and angular
 * distance" spherical formulae so it wraps cleanly across the poles and the
 * antimeridian.
 */
function smallCirclePositions(
  Cesium: CesiumModule,
  centerLatDeg: number,
  centerLonDeg: number,
  angularRadiusDeg: number,
  segments = 180
) {
  const latC = Cesium.Math.toRadians(centerLatDeg);
  const lonC = Cesium.Math.toRadians(centerLonDeg);
  const ang = Cesium.Math.toRadians(angularRadiusDeg);
  const sinLatC = Math.sin(latC);
  const cosLatC = Math.cos(latC);
  const sinAng = Math.sin(ang);
  const cosAng = Math.cos(ang);

  const positions = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (i / segments) * 2 * Math.PI;
    const lat = Math.asin(sinLatC * cosAng + cosLatC * sinAng * Math.cos(bearing));
    const lon =
      lonC +
      Math.atan2(Math.sin(bearing) * sinAng * cosLatC, cosAng - sinLatC * Math.sin(lat));
    positions.push(Cesium.Cartesian3.fromRadians(lon, lat, 0));
  }
  return positions;
}

/**
 * Manages the aurora-ring primitives for one Cesium Viewer. Construct once per
 * viewer; call update(kp) whenever the Kp index changes; destroy() on teardown.
 */
export class AuroraOvalLayer {
  private readonly viewer: Viewer;
  private readonly Cesium: CesiumModule;
  private primitives: Primitive[] = [];
  private lastKp: number | null = null;

  constructor(viewer: Viewer, Cesium: CesiumModule) {
    this.viewer = viewer;
    this.Cesium = Cesium;
  }

  /** Remove every ring we've added (guarded against a destroyed scene). */
  private clear(): void {
    if (this.viewer.isDestroyed()) {
      this.primitives = [];
      return;
    }
    for (const primitive of this.primitives) {
      try {
        this.viewer.scene.primitives.remove(primitive);
      } catch {
        /* already gone — ignore */
      }
    }
    this.primitives = [];
  }

  /** Rebuild the rings for the given Kp index (0–9). Idempotent per value. */
  update(kp: number): void {
    if (this.viewer.isDestroyed()) return;

    const safeKp = Math.min(9, Math.max(0, Number.isFinite(kp) ? kp : 0));
    if (this.lastKp === safeKp && this.primitives.length > 0) return; // no-op
    this.lastKp = safeKp;

    this.clear();

    const C = this.Cesium;
    const boundary = auroralBoundaryLatitude(safeKp);
    // Co-latitude from the pole → the ring's angular radius. Grows as Kp climbs.
    const angularRadius = 90 - boundary;
    // Brighter and wider during stronger storms, but always clearly translucent.
    const intensity = safeKp / 9;
    const alpha = 0.18 + 0.22 * intensity;
    const widthMeters = 300_000 + 250_000 * intensity;

    for (const pole of GEOMAGNETIC_POLES) {
      const centerline = smallCirclePositions(C, pole.lat, pole.lon, angularRadius);

      const instance = new C.GeometryInstance({
        geometry: new C.CorridorGeometry({
          positions: centerline,
          width: widthMeters,
          cornerType: C.CornerType.ROUNDED,
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.GREEN.withAlpha(alpha)),
        },
      });

      const primitive = new C.Primitive({
        geometryInstances: instance,
        appearance: new C.PerInstanceColorAppearance({ translucent: true, flat: true }),
        // Synchronous so it appears at once and is safe to remove immediately.
        asynchronous: false,
      });

      this.viewer.scene.primitives.add(primitive);
      this.primitives.push(primitive);
    }

    // Nudge a frame in case the globe runs in request-render mode.
    this.viewer.scene.requestRender();
  }

  /** Tear everything down. Safe to call multiple times. */
  destroy(): void {
    this.clear();
    this.lastKp = null;
  }
}
