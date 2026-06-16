// =============================================================================
// hooks/useFovPlanner.ts — the FOV planner engine (camera + entities + math)
// =============================================================================
// THE SKY-DOME MODEL
// An FOV reticle and a transit path are ANGULAR constructs — they live in the
// observer's sky, not at any particular 3D distance. So every direction
// (reticle rays, trajectory look-angles) is projected onto a virtual dome of
// fixed radius centered on the observer, and the Cesium camera is placed
// EXACTLY at the observer. Two things fall out for free:
//
//   · The live satellite entities (true 3D positions) visually coincide with
//     the dome overlay, because from the observer both project to the same
//     screen direction. The real ISS dot rides the predicted path.
//   · The trajectory line passes through the reticle precisely as the target
//     will transit the camera frame.
//
// AIM SEMANTICS (astrophotography, not videography): the frame is FROZEN at
// the target's direction when the planner engages — you aim a tripod, you
// don't slew it. The target then drifts through the frame along the drawn
// path. "Re-center" re-aims at the target's current position.
//
// FREE LOOK (Stellarium-style): the camera stands on the tripod but the USER
// owns the view — drag grabs the sky (pan heading/pitch), the wheel zooms
// the viewfinder. Cesium's default controller would orbit the globe instead,
// so it stays disabled and a dedicated ScreenSpaceEventHandler implements
// ground-based look-around. Wandering >1° off the frame aim raises `drifted`,
// which the UI surfaces as a "re-lock" affordance. A horizon ring with
// cardinal letters (N amber, E/S/W bright, intercardinals faint) keeps the
// user oriented exactly like Stellarium's landscape compass.
//
// LIVE RESIZE: reticle/thirds/crosshair positions are CallbackProperties that
// read the focal length from a ref — dragging the slider re-shapes the frame
// on the very next rendered frame with zero React re-renders and zero entity
// churn.
// =============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import type { Entity } from "cesium";
import { useTracker } from "@/hooks/useTracker";
import { useViewerBridge } from "@/lib/viewerBridge";
import { getLookAngles } from "@/utils/orbitalMath";
import { getBodySky } from "@/lib/celestialBodies";
import {
  enuDirection,
  frameBasis,
  frameCoords,
  reticleOutline,
  thirdsGrid,
  crosshairLines,
  tanLimits,
  fovDegrees,
  type FrameBasis,
  type SensorPreset,
  type Vec3,
} from "@/lib/fovMath";
import type { CatalogEntry } from "@/lib/tracker";
import type { Observer } from "@/lib/layers";

/** Radius of the virtual sky dome the overlay is drawn on (any value works —
 *  directions are what matter — but it must clear terrain and stay well under
 *  real satellite ranges so depth sorting never fights the live entities). */
const DOME_RADIUS_M = 100_000;
/** Trajectory lookahead per the brief: 15 minutes for satellites. */
const SAT_LOOKAHEAD_S = 15 * 60;
const SAT_STEP_S = 5;
/** Planets crawl (~15°/h): widen the window so the drift is visible. */
const PLANET_LOOKAHEAD_S = 90 * 60;
const PLANET_STEP_S = 60;
/** Re-sample the trajectory this often while the planner is open. */
const PATH_REFRESH_MS = 30_000;
/** Looking >1° away from the frame aim counts as "drifted". */
const DRIFT_THRESHOLD_RAD = Math.PI / 180;
/** Viewfinder zoom limits for the scroll wheel (degrees). */
const MIN_CAMERA_FOV_DEG = 1.5;
const MAX_CAMERA_FOV_DEG = 75;

/** Horizon compass, Stellarium-style. Azimuth 0 = N, 90 = E. */
const COMPASS_POINTS = [
  { az: 0, text: "N", major: true },
  { az: 45, text: "NE", major: false },
  { az: 90, text: "E", major: true },
  { az: 135, text: "SE", major: false },
  { az: 180, text: "S", major: true },
  { az: 225, text: "SW", major: false },
  { az: 270, text: "W", major: true },
  { az: 315, text: "NW", major: false },
];

export interface TransitInfo {
  status: "window" | "always" | "never";
  enter?: Date;
  exit?: Date;
  durationS?: number;
}

interface TrajectorySample {
  time: Date;
  dir: Vec3;
}

interface FovPlannerOptions {
  active: boolean;
  targetId: string | null;
  observer: Observer;
  focalLengthMm: number;
  sensor: SensorPreset;
  /** Bump to re-aim the frozen frame at the target's current direction. */
  recenterKey: number;
}

export function useFovPlanner({
  active,
  targetId,
  observer,
  focalLengthMm,
  sensor,
  recenterKey,
}: FovPlannerOptions) {
  const bridge = useViewerBridge();
  const tracker = useTracker();

  const [aim, setAim] = useState<{ azimuth: number; altitude: number } | null>(null);
  const [transit, setTransit] = useState<TransitInfo | null>(null);
  /** True when the user has free-looked >1° away from the frame aim. */
  const [drifted, setDrifted] = useState(false);

  // Optics state lives in refs: the per-frame CallbackProperties and the
  // transit recompute read these without re-running the lifecycle effect.
  const focalRef = useRef(focalLengthMm);
  focalRef.current = focalLengthMm;
  const sensorRef = useRef(sensor);
  sensorRef.current = sensor;
  const basisRef = useRef<FrameBasis | null>(null);
  const samplesRef = useRef<TrajectorySample[]>([]);

  /** Sky direction of the target right now (kind-agnostic). */
  function currentDirection(entry: CatalogEntry) {
    const now = new Date();
    if (entry.kind === "satellite" && entry.satrec) return getLookAngles(entry.satrec, observer, now);
    if (entry.kind === "planet" && entry.body) return getBodySky(entry.body, observer, now);
    return null;
  }

  /** Camera zoom: frame the reticle at ~1/3 of the viewport for context. */
  function applyViewfinderZoom() {
    if (!bridge || bridge.viewer.isDestroyed()) return;
    const { viewer, Cesium } = bridge;
    if (!(viewer.camera.frustum instanceof Cesium.PerspectiveFrustum)) return;
    const h = fovDegrees(sensorRef.current.widthMm, focalRef.current);
    const v = fovDegrees(sensorRef.current.heightMm, focalRef.current);
    const target = Math.max(h, v) * 3;
    viewer.camera.frustum.fov = Cesium.Math.toRadians(Math.min(Math.max(target, 8), 65));
  }

  /** Transit window: first contiguous run of trajectory samples inside the frame. */
  function computeTransit() {
    const basis = basisRef.current;
    const samples = samplesRef.current;
    if (!basis || samples.length === 0) {
      setTransit(null);
      return;
    }
    const { tanH, tanV } = tanLimits(sensorRef.current, focalRef.current);
    let enter: Date | null = null;
    let exit: Date | null = null;
    for (const s of samples) {
      const c = frameCoords(basis, s.dir);
      const inside = c.forward && Math.abs(c.x) <= tanH && Math.abs(c.y) <= tanV;
      if (inside && !enter) enter = s.time;
      if (!inside && enter && !exit) {
        exit = s.time;
        break; // first window only — the one the photographer cares about
      }
    }
    if (!enter) setTransit({ status: "never" });
    else if (!exit && enter.getTime() === samples[0].time.getTime()) setTransit({ status: "always" });
    else {
      const end = exit ?? samples[samples.length - 1].time;
      setTransit({
        status: "window",
        enter,
        exit: end,
        durationS: Math.round((end.getTime() - enter.getTime()) / 1000),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle: build the rig when the planner opens, tear it down on exit.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!active || !bridge || !targetId) {
      setAim(null);
      setTransit(null);
      return;
    }
    const { viewer, Cesium } = bridge;
    if (viewer.isDestroyed()) return;
    const entry = tracker.getCatalogEntry(targetId);
    if (!entry) return;

    let disposed = false;
    const ownedEntities: Entity[] = [];
    let pathEntity: Entity | null = null;
    let tickEntities: Entity[] = [];

    // ---- observer frame: ENU -> ECEF, camera anchored 2 m above the site --
    const eyeCart = Cesium.Cartesian3.fromDegrees(
      observer.longitude,
      observer.latitude,
      (observer.heightM ?? 0) + 2
    );
    const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(eyeCart);
    const toWorld = (v: Vec3) =>
      Cesium.Matrix4.multiplyByPoint(
        enuMatrix,
        new Cesium.Cartesian3(v.x * DOME_RADIUS_M, v.y * DOME_RADIUS_M, v.z * DOME_RADIUS_M),
        new Cesium.Cartesian3()
      );

    // ---- freeze the aim at the target's CURRENT direction ------------------
    const aimNow = currentDirection(entry);
    if (!aimNow) return;
    basisRef.current = frameBasis(enuDirection(aimNow.azimuth, aimNow.altitude));
    const frameDir = basisRef.current.dir;
    setAim({ azimuth: aimNow.azimuth, altitude: aimNow.altitude });
    setDrifted(false);

    // ---- reticle entities: live-resizing via CallbackProperty --------------
    const cyan = Cesium.Color.fromCssColorString("#2dd4ff");
    const starlight = Cesium.Color.fromCssColorString("#eef2ff");

    const dynamicLine = (
      compute: (basis: FrameBasis, tanH: number, tanV: number) => Vec3[],
      width: number,
      color: import("cesium").Color
    ) =>
      viewer.entities.add({
        polyline: {
          // Re-evaluated every rendered frame: reads the CURRENT focal length
          // from the ref, so slider drags reshape the frame instantly.
          positions: new Cesium.CallbackProperty(() => {
            const basis = basisRef.current;
            if (!basis) return [];
            const { tanH, tanV } = tanLimits(sensorRef.current, focalRef.current);
            return compute(basis, tanH, tanV).map(toWorld);
          }, false) as unknown as import("cesium").Property,
          width,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color }),
          // Below-horizon directions land "inside" the Earth — render them
          // dimmed instead of hidden, so the frame stays plannable even when
          // the target hasn't risen yet.
          depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.25,
            color: color.withAlpha(0.3),
          }),
        },
      });

    // Frame border (bright), rule-of-thirds (faint), center crosshair.
    ownedEntities.push(dynamicLine((b, h, v) => reticleOutline(b, h, v, 8), 2.8, cyan));
    for (let i = 0; i < 4; i++) {
      ownedEntities.push(
        dynamicLine((b, h, v) => thirdsGrid(b, h, v, 8)[i], 1.2, starlight.withAlpha(0.22))
      );
    }
    for (let i = 0; i < 2; i++) {
      ownedEntities.push(
        dynamicLine((b, h, v) => crosshairLines(b, h, v)[i], 1.5, cyan.withAlpha(0.65))
      );
    }

    // ---- horizon compass: Stellarium-style orientation ---------------------
    const amber = Cesium.Color.fromCssColorString("#fbbf24");
    const faintBlue = Cesium.Color.fromCssColorString("#5a6790");

    // Dashed horizon ring at altitude 0° — the line the compass sits on.
    const horizonPositions: import("cesium").Cartesian3[] = [];
    for (let az = 0; az <= 360; az += 4) horizonPositions.push(toWorld(enuDirection(az, 0)));
    ownedEntities.push(
      viewer.entities.add({
        polyline: {
          positions: horizonPositions,
          width: 1.4,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: starlight.withAlpha(0.3),
            dashLength: 12,
          }),
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
            color: starlight.withAlpha(0.1),
            dashLength: 12,
          }),
        },
      })
    );

    // Cardinal letters + ticks. N is amber (Stellarium highlights north),
    // E/S/W bright, intercardinals faint. Labels never depth-hide, so the
    // compass reads even where the horizon dips behind terrain.
    for (const point of COMPASS_POINTS) {
      const color = point.az === 0 ? amber : point.major ? starlight : faintBlue;
      ownedEntities.push(
        viewer.entities.add({
          position: toWorld(enuDirection(point.az, 0)),
          label: {
            text: point.text,
            font: point.major
              ? "bold 15px 'IBM Plex Mono', monospace"
              : "11px 'IBM Plex Mono', monospace",
            fillColor: color,
            outlineColor: Cesium.Color.fromCssColorString("#04060f"),
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -8),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
        viewer.entities.add({
          polyline: {
            positions: [toWorld(enuDirection(point.az, -0.8)), toWorld(enuDirection(point.az, 0.9))],
            width: point.major ? 2 : 1.2,
            arcType: Cesium.ArcType.NONE,
            material: color.withAlpha(point.major ? 0.7 : 0.4),
            depthFailMaterial: color.withAlpha(0.15),
          },
        })
      );
    }

    // ---- trajectory: predicted positions through the frame -----------------
    function rebuildTrajectory() {
      if (disposed || viewer.isDestroyed() || !entry) return;
      const isSat = entry.kind === "satellite" && !!entry.satrec;
      const stepS = isSat ? SAT_STEP_S : PLANET_STEP_S;
      const spanS = isSat ? SAT_LOOKAHEAD_S : PLANET_LOOKAHEAD_S;
      const start = new Date();

      const samples: TrajectorySample[] = [];
      for (let t = 0; t <= spanS; t += stepS) {
        const date = new Date(start.getTime() + t * 1000);
        const look =
          isSat && entry.satrec
            ? getLookAngles(entry.satrec, observer, date)
            : entry.body
              ? getBodySky(entry.body, observer, date)
              : null;
        if (!look) continue;
        samples.push({ time: date, dir: enuDirection(look.azimuth, look.altitude) });
      }
      samplesRef.current = samples;

      // Glowing path across the sky dome, in the target layer's color.
      const positions = samples.map((s) => toWorld(s.dir));
      if (!pathEntity) {
        pathEntity = viewer.entities.add({
          polyline: {
            positions,
            width: 4,
            arcType: Cesium.ArcType.NONE,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.22,
              color: Cesium.Color.fromCssColorString(entry.color).withAlpha(0.9),
            }),
            depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.22,
              color: Cesium.Color.fromCssColorString(entry.color).withAlpha(0.35),
            }),
          },
        });
        ownedEntities.push(pathEntity);
      } else if (pathEntity.polyline) {
        pathEntity.polyline.positions = new Cesium.ConstantProperty(positions);
      }

      // Time pips so the user can read transit speed off the path.
      for (const e of tickEntities) viewer.entities.remove(e);
      tickEntities = [];
      const pipEveryS = isSat ? 300 : 1800; // +5 min / +30 min
      for (let t = pipEveryS; t < spanS; t += pipEveryS) {
        const sample = samples[Math.round(t / stepS)];
        if (!sample) continue;
        tickEntities.push(
          viewer.entities.add({
            position: toWorld(sample.dir),
            point: {
              pixelSize: 5,
              color: starlight,
              outlineColor: cyan,
              outlineWidth: 1.5,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: `+${Math.round(t / 60)}′`,
              font: "11px 'IBM Plex Mono', monospace",
              fillColor: starlight,
              pixelOffset: new Cesium.Cartesian2(0, -12),
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
        );
      }

      computeTransit();
    }

    rebuildTrajectory();
    const refreshTimer = setInterval(rebuildTrajectory, PATH_REFRESH_MS);

    // ---- viewfinder camera: stand at the observer, look down the aim ------
    // The DEFAULT controller stays off: at ground level it orbits the globe,
    // which is exactly wrong for a tripod. The free-look handler below
    // replaces it with Stellarium-style pan/zoom.
    const controller = viewer.scene.screenSpaceCameraController;
    controller.enableInputs = false;
    // Cesium's camera-flight internals toggle enableInputs behind our back
    // (disable on takeoff, re-enable on landing/cancel). Win that argument
    // with a per-frame guard instead of chasing each code path.
    const removeInputGuard = viewer.scene.postRender.addEventListener(() => {
      if (controller.enableInputs) controller.enableInputs = false;
    });
    viewer.trackedEntity = undefined;

    // ---- free look: grab the sky to pan, scroll to zoom --------------------
    // World-space aim direction, for drift measurement.
    const aimWorldDir = Cesium.Matrix4.multiplyByPointAsVector(
      enuMatrix,
      new Cesium.Cartesian3(frameDir.x, frameDir.y, frameDir.z),
      new Cesium.Cartesian3()
    );
    Cesium.Cartesian3.normalize(aimWorldDir, aimWorldDir);

    const updateDrift = () => {
      if (viewer.isDestroyed()) return;
      const separation = Cesium.Cartesian3.angleBetween(viewer.camera.directionWC, aimWorldDir);
      setDrifted(separation > DRIFT_THRESHOLD_RAD);
    };

    const lookHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    let grabbing = false;

    lookHandler.setInputAction(() => {
      grabbing = true;
      viewer.camera.cancelFlight(); // grabbing mid-approach hands over control
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    lookHandler.setInputAction(() => {
      grabbing = false;
      updateDrift();
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    lookHandler.setInputAction(
      (movement: { startPosition: { x: number; y: number }; endPosition: { x: number; y: number } }) => {
        if (!grabbing || viewer.isDestroyed()) return;
        const frustum = viewer.camera.frustum;
        if (!(frustum instanceof Cesium.PerspectiveFrustum)) return;
        // Sensitivity tracks zoom: one full-canvas drag ≈ one full FOV sweep.
        const fovRad = frustum.fov ?? Cesium.Math.toRadians(60);
        const radPerPixel = fovRad / viewer.scene.canvas.clientWidth;
        const dx = movement.endPosition.x - movement.startPosition.x;
        const dy = movement.endPosition.y - movement.startPosition.y;
        // "Grab the sky": dragging right pulls the sky right (heading -).
        viewer.camera.setView({
          destination: eyeCart, // feet stay planted on the tripod
          orientation: {
            heading: viewer.camera.heading - dx * radPerPixel,
            pitch: Cesium.Math.clamp(
              viewer.camera.pitch + dy * radPerPixel,
              Cesium.Math.toRadians(-89),
              Cesium.Math.toRadians(89)
            ),
            roll: 0,
          },
        });
        updateDrift();
      },
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    );

    lookHandler.setInputAction((wheelDelta: number) => {
      if (viewer.isDestroyed()) return;
      const frustum = viewer.camera.frustum;
      if (!(frustum instanceof Cesium.PerspectiveFrustum)) return;
      // Wheel up tightens the view, like zooming a lens.
      const factor = wheelDelta > 0 ? 0.85 : 1 / 0.85;
      frustum.fov = Cesium.Math.clamp(
        (frustum.fov ?? Cesium.Math.toRadians(60)) * factor,
        Cesium.Math.toRadians(MIN_CAMERA_FOV_DEG),
        Cesium.Math.toRadians(MAX_CAMERA_FOV_DEG)
      );
    }, Cesium.ScreenSpaceEventType.WHEEL);
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({
      destination: eyeCart,
      orientation: {
        heading: Cesium.Math.toRadians(aimNow.azimuth),
        pitch: Cesium.Math.toRadians(aimNow.altitude),
        roll: 0,
      },
      duration: 1.6,
      complete: () => {
        if (disposed) return;
        applyViewfinderZoom();
        // Cesium's camera.flyTo re-enables inputs when the flight lands —
        // re-assert the viewfinder lock AFTER it has had its say.
        controller.enableInputs = false;
      },
    });

    return () => {
      disposed = true;
      clearInterval(refreshTimer);
      removeInputGuard();
      lookHandler.destroy();
      setDrifted(false);
      if (!viewer.isDestroyed()) {
        for (const e of ownedEntities) viewer.entities.remove(e);
        for (const e of tickEntities) viewer.entities.remove(e);
        // Hand the camera back: stock frustum + inputs. CesiumGlobe's lock
        // effect re-engages the orbit view once suppression lifts.
        if (viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
          viewer.camera.frustum.fov = Cesium.Math.toRadians(60);
        }
        controller.enableInputs = true;
      }
      basisRef.current = null;
      samplesRef.current = [];
    };
    // recenterKey intentionally re-runs the whole rig to re-aim the frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bridge, targetId, observer.latitude, observer.longitude, recenterKey]);

  // -----------------------------------------------------------------------
  // Optics changed: retune the camera zoom + transit window. The reticle
  // itself needs nothing — its CallbackProperties already read the refs.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!active || !bridge) return;
    applyViewfinderZoom();
    computeTransit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focalLengthMm, sensor, active, bridge]);

  return { aim, transit, drifted };
}
