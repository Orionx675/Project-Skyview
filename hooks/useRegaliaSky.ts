// =============================================================================
// hooks/useRegaliaSky.ts — optimized deep-sky rendering engine (Cesium)
// =============================================================================
// Renders thousands of stars, constellation stick-figures, constellation
// name-labels and Messier DSOs onto the SHARED Cesium scene (via viewerBridge)
// without React ever re-rendering.
//
// PERFORMANCE — the whole point of the brief:
//   · Stars are ONE Cesium.PointPrimitiveCollection, not N entities. That's a
//     single optimized batch; thousands of points cost ~one draw.
//   · Constellation lines are ONE Cesium.PolylineCollection; names + DSO
//     labels are LabelCollections; DSOs are a PointPrimitiveCollection.
//   · Catalogs are built ONCE on activation. The 1 Hz-style work is a single
//     modelMatrix assignment per collection per frame (see below) — trivial.
//
// SIDEREAL ALIGNMENT — positions are computed in the inertial equatorial frame
// (RA/Dec). Each frame we set every collection's `modelMatrix` to the
// inertial→Earth-fixed rotation (GMST about the pole), matching the convention
// satellite.js uses for ECI→ECF. The celestial sphere therefore sits in the
// same frame as the globe + satellites and drifts with sidereal time.
// =============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { gstime } from "satellite.js";
import type * as CesiumNS from "cesium";
import { useViewerBridge } from "@/lib/viewerBridge";
import {
  CELESTIAL_RADIUS_M,
  raDecToCartesian,
  magnitudeToPixelSize,
  bvToColorRgb,
  dsoCategoryColor,
  loadStarCatalog,
  loadConstellations,
  loadMessier,
  type MessierObject,
  type Star,
} from "@/lib/starCatalog";
import {
  crosshairLines,
  equatorialUnitVec3,
  fovDegrees,
  frameBasis,
  isInFrame,
  limitingMagnitude,
  reticleOutline,
  tanLimits,
  thirdsGrid,
  type SensorPreset,
} from "@/lib/fovMath";

export type RegaliaSelection =
  | { kind: "star"; star: Star }
  | { kind: "dso"; dso: MessierObject };

export interface RegaliaLayers {
  stars: boolean;
  lines: boolean;
  art: boolean;
  dso: boolean;
}

export interface RegaliaStatus {
  loading: boolean;
  error: string | null;
  starCount: number;
  dsoCount: number;
}

/** One object listed inside the locked reticle (Frame Analysis). */
export interface FrameObject {
  label: string;
  sub: string;
  mag: number;
  kind: "star" | "dso";
}

/** "Frame Analysis" readout for the locked target's reticle. */
export interface FrameAnalysis {
  constellation: string;
  starCount: number;
  dsoCount: number;
  limitingMag: number;
  objects: FrameObject[];
}

interface Collections {
  stars?: CesiumNS.PointPrimitiveCollection;
  lines?: CesiumNS.PolylineCollection;
  art?: CesiumNS.LabelCollection;
  dsoPoints?: CesiumNS.PointPrimitiveCollection;
  dsoLabels?: CesiumNS.LabelCollection;
  reticle?: CesiumNS.PolylineCollection;
  handler?: CesiumNS.ScreenSpaceEventHandler;
  removePreRender?: () => void;
  // Catalog kept for the FOV effect (magnitude reveal + frame analysis).
  starList?: Star[];
  messier?: MessierObject[];
}

export function useRegaliaSky({
  active,
  layers,
  onSelect,
  lockTarget = null,
  focalLengthMm = 50,
  sensor,
}: {
  active: boolean;
  layers: RegaliaLayers;
  onSelect: (selection: RegaliaSelection) => void;
  /** The clicked object to frame; null = no lock (free sky view). */
  lockTarget?: RegaliaSelection | null;
  focalLengthMm?: number;
  sensor: SensorPreset;
}): { status: RegaliaStatus; frameAnalysis: FrameAnalysis | null } {
  const bridge = useViewerBridge();
  const [status, setStatus] = useState<RegaliaStatus>({
    loading: false,
    error: null,
    starCount: 0,
    dsoCount: 0,
  });
  const [frameAnalysis, setFrameAnalysis] = useState<FrameAnalysis | null>(null);
  /** Bumped when the catalog finishes (re)building, so the FOV effect re-runs. */
  const [built, setBuilt] = useState(0);

  const refs = useRef<Collections>({});
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  /** Inertial unit direction of the lock target (null when unlocked); read by
   *  the per-frame updater to keep the camera aimed as the sky rotates. */
  const lockDirRef = useRef<CesiumNS.Cartesian3 | null>(null);
  /** Whether a lock was active last time (distinguishes unlock from never). */
  const lockedPrevRef = useRef(false);

  function applyVisibility(l: RegaliaLayers) {
    const r = refs.current;
    if (r.stars) r.stars.show = l.stars;
    if (r.lines) r.lines.show = l.lines;
    if (r.art) r.art.show = l.art;
    if (r.dsoPoints) r.dsoPoints.show = l.dso;
    if (r.dsoLabels) r.dsoLabels.show = l.dso;
  }

  // ---------------------------------------------------------------- build --
  useEffect(() => {
    if (!active || !bridge) return;
    const { viewer, Cesium } = bridge;
    if (viewer.isDestroyed()) return;

    let cancelled = false;
    setStatus((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      let stars: Star[];
      let cons: Awaited<ReturnType<typeof loadConstellations>>;
      let messier: MessierObject[];
      try {
        [stars, cons, messier] = await Promise.all([
          loadStarCatalog(6.0),
          loadConstellations(),
          loadMessier(),
        ]);
      } catch (err) {
        if (!cancelled) {
          setStatus({
            loading: false,
            error: err instanceof Error ? err.message : "Catalog load failed",
            starCount: 0,
            dsoCount: 0,
          });
        }
        return;
      }
      if (cancelled || viewer.isDestroyed()) return;

      const scene = viewer.scene;
      const R = CELESTIAL_RADIUS_M;

      // ---- stars: one PointPrimitiveCollection (the optimization) ---------
      const starPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection());
      const posByHip = new Map<number, CesiumNS.Cartesian3>();
      for (const s of stars) {
        const pos = raDecToCartesian(s.ra, s.dec, R, Cesium);
        posByHip.set(s.hip, pos);
        const [r, g, b] = bvToColorRgb(s.bv);
        starPoints.add({
          position: pos,
          pixelSize: magnitudeToPixelSize(s.mag),
          color: new Cesium.Color(r, g, b, 1.0),
          // depth test stays ON (default) so the Earth occludes stars behind
          // it — physically correct for a sphere enclosing the globe.
          id: { kind: "star", star: s } as RegaliaSelection,
        });
      }

      // ---- constellation lines: one PolylineCollection --------------------
      const lines = scene.primitives.add(new Cesium.PolylineCollection());
      const lineColor = Cesium.Color.fromCssColorString("#7c93d8").withAlpha(0.55);
      for (const c of cons) {
        for (const [a, b] of c.segments) {
          const pa = posByHip.get(a);
          const pb = posByHip.get(b);
          if (!pa || !pb) continue; // skip edges whose stars aren't loaded
          lines.add({
            positions: [pa, pb],
            width: 1.4,
            material: Cesium.Material.fromType("Color", { color: lineColor }),
          });
        }
      }

      // ---- constellation "art": name labels at each figure's centroid -----
      const art = scene.primitives.add(new Cesium.LabelCollection());
      for (const c of cons) {
        const pts: CesiumNS.Cartesian3[] = [];
        for (const seg of c.segments) {
          for (const hip of seg) {
            const p = posByHip.get(hip);
            if (p) pts.push(p);
          }
        }
        if (pts.length === 0) continue;
        const centroid = new Cesium.Cartesian3();
        for (const p of pts) Cesium.Cartesian3.add(centroid, p, centroid);
        Cesium.Cartesian3.divideByScalar(centroid, pts.length, centroid);
        // Re-project onto the sphere so labels sit cleanly on the dome.
        Cesium.Cartesian3.normalize(centroid, centroid);
        Cesium.Cartesian3.multiplyByScalar(centroid, R, centroid);
        art.add({
          position: centroid,
          text: c.name.toUpperCase(),
          font: "600 13px sans-serif",
          fillColor: Cesium.Color.fromCssColorString("#a78bfa").withAlpha(0.6),
          outlineColor: Cesium.Color.fromCssColorString("#04060f"),
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        });
      }

      // ---- deep-sky objects: points + labels ------------------------------
      const dsoPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection());
      const dsoLabels = scene.primitives.add(new Cesium.LabelCollection());
      for (const m of messier) {
        const pos = raDecToCartesian(m.ra, m.dec, R, Cesium);
        const color = Cesium.Color.fromCssColorString(dsoCategoryColor(m.type));
        dsoPoints.add({
          position: pos,
          pixelSize: 10,
          color: color.withAlpha(0.85),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
          outlineWidth: 1.5,
          id: { kind: "dso", dso: m } as RegaliaSelection,
        });
        dsoLabels.add({
          position: pos,
          text: m.id,
          font: "600 11px monospace",
          fillColor: color,
          outlineColor: Cesium.Color.fromCssColorString("#04060f"),
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        });
      }

      // ---- FOV reticle: drawn into this collection when a target is locked
      const reticle = scene.primitives.add(new Cesium.PolylineCollection());

      refs.current = {
        stars: starPoints,
        lines,
        art,
        dsoPoints,
        dsoLabels,
        reticle,
        starList: stars,
        messier,
      };
      applyVisibility(layersRef.current);

      // ---- per-frame sidereal rotation: inertial → Earth-fixed ------------
      const scratch = new Cesium.Matrix4();
      const worldDir = new Cesium.Cartesian3();
      const upScratch = new Cesium.Cartesian3();
      const projScratch = new Cesium.Cartesian3();
      const update = () => {
        // GMST from the sim clock (scrubbable), so the sky rotates to any epoch.
        const g = gstime(Cesium.JulianDate.toDate(viewer.clock.currentTime)); // radians
        const cos = Math.cos(g);
        const sin = Math.sin(g);
        // Row-major: matches satellite.js ECI→ECF [[c,s,0],[-s,c,0],[0,0,1]].
        const m3 = new Cesium.Matrix3(cos, sin, 0, -sin, cos, 0, 0, 0, 1);
        const mat = Cesium.Matrix4.fromRotationTranslation(m3, Cesium.Cartesian3.ZERO, scratch);
        const r = refs.current;
        for (const col of [r.stars, r.lines, r.art, r.dsoPoints, r.dsoLabels, r.reticle]) {
          if (col) col.modelMatrix = mat;
        }

        // Deep-sky target lock: stand at the sphere's center and follow the
        // (rotating) target world direction so it stays framed in the reticle.
        const ld = lockDirRef.current;
        if (ld) {
          Cesium.Matrix3.multiplyByVector(m3, ld, worldDir);
          Cesium.Cartesian3.normalize(worldDir, worldDir);
          const ref = Math.abs(worldDir.z) > 0.99 ? Cesium.Cartesian3.UNIT_Y : Cesium.Cartesian3.UNIT_Z;
          const d = Cesium.Cartesian3.dot(ref, worldDir);
          Cesium.Cartesian3.subtract(
            ref,
            Cesium.Cartesian3.multiplyByScalar(worldDir, d, projScratch),
            upScratch
          );
          Cesium.Cartesian3.normalize(upScratch, upScratch);
          // 1 m off-center avoids degenerate cartographic(0,0,0) each frame.
          viewer.camera.setView({
            destination: Cesium.Cartesian3.multiplyByScalar(worldDir, 1, projScratch),
            orientation: { direction: worldDir, up: upScratch },
          });
        }
      };
      update();
      refs.current.removePreRender = scene.preRender.addEventListener(update);

      // ---- click-to-inspect: pick a star / DSO ----------------------------
      const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
      handler.setInputAction((movement: { position: CesiumNS.Cartesian2 }) => {
        const picked = scene.pick(new Cesium.Cartesian2(movement.position.x, movement.position.y));
        const id = picked?.id as RegaliaSelection | undefined;
        if (id && (id.kind === "star" || id.kind === "dso")) onSelectRef.current(id);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      refs.current.handler = handler;

      if (!cancelled) {
        setStatus({ loading: false, error: null, starCount: stars.length, dsoCount: messier.length });
        setBuilt((b) => b + 1); // let the FOV effect (re)apply against fresh collections
      }
    })();

    return () => {
      cancelled = true;
      const r = refs.current;
      r.removePreRender?.();
      r.handler?.destroy();
      if (!viewer.isDestroyed()) {
        for (const col of [r.stars, r.lines, r.art, r.dsoPoints, r.dsoLabels, r.reticle]) {
          if (col) viewer.scene.primitives.remove(col); // remove() also destroys it
        }
        // Restore any scene state the deep-sky lock changed.
        viewer.scene.globe.show = true;
        viewer.scene.screenSpaceCameraController.enableInputs = true;
        const frustum = viewer.camera.frustum;
        if (frustum instanceof Cesium.PerspectiveFrustum) frustum.fov = Cesium.Math.toRadians(60);
      }
      lockDirRef.current = null;
      lockedPrevRef.current = false;
      refs.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bridge]);

  // Layer toggles: cheap show/hide, never a rebuild.
  useEffect(() => {
    applyVisibility(layers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.stars, layers.lines, layers.art, layers.dso]);

  // ------------------------------------------------------------- FOV lock --
  // Lightweight: redraws the reticle, re-applies the magnitude reveal, aims
  // the camera and recomputes Frame Analysis. NEVER rebuilds the catalog, so
  // it can run on every focal-slider tick without cost.
  useEffect(() => {
    if (!active || !bridge) return;
    const { viewer, Cesium } = bridge;
    if (viewer.isDestroyed()) return;
    const r = refs.current;
    if (!r.reticle || !r.stars || !r.starList || !r.messier) return; // not built yet
    const scene = viewer.scene;
    const ctrl = scene.screenSpaceCameraController;
    const frustum = viewer.camera.frustum;

    r.reticle.removeAll();

    // ---- unlocked: reveal all naked-eye stars, restore the free sky view --
    if (!lockTarget) {
      lockDirRef.current = null;
      for (let i = 0; i < r.stars.length; i++) r.stars.get(i).show = true;
      setFrameAnalysis(null);
      if (lockedPrevRef.current) {
        lockedPrevRef.current = false;
        ctrl.enableInputs = true;
        scene.globe.show = true;
        if (frustum instanceof Cesium.PerspectiveFrustum) frustum.fov = Cesium.Math.toRadians(60);
        // Return to the idle "Earth among the stars" vantage.
        const dest = new Cesium.Cartesian3(0, -7e7, 2.5e7);
        const dir = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.negate(dest, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        viewer.camera.setView({ destination: dest, orientation: { direction: dir, up: Cesium.Cartesian3.UNIT_Z } });
      }
      return;
    }

    // ---- locked on a deep-sky target -------------------------------------
    const ra = lockTarget.kind === "star" ? lockTarget.star.ra : lockTarget.dso.ra;
    const dec = lockTarget.kind === "star" ? lockTarget.star.dec : lockTarget.dso.dec;
    const dInert = equatorialUnitVec3(ra, dec);
    lockDirRef.current = new Cesium.Cartesian3(dInert.x, dInert.y, dInert.z);
    lockedPrevRef.current = true;

    const basis = frameBasis(dInert);
    const { tanH, tanV } = tanLimits(sensor, focalLengthMm);
    const R = CELESTIAL_RADIUS_M;
    const toCart = (v: { x: number; y: number; z: number }) =>
      new Cesium.Cartesian3(v.x * R, v.y * R, v.z * R);
    const cyan = Cesium.Color.fromCssColorString("#2dd4ff");

    // Frame border, rule-of-thirds, crosshair — all on the celestial sphere.
    r.reticle.add({
      positions: reticleOutline(basis, tanH, tanV, 12).map(toCart),
      width: 2.6,
      material: Cesium.Material.fromType("Color", { color: cyan }),
    });
    for (const line of thirdsGrid(basis, tanH, tanV, 8)) {
      r.reticle.add({
        positions: line.map(toCart),
        width: 1,
        material: Cesium.Material.fromType("Color", { color: cyan.withAlpha(0.22) }),
      });
    }
    for (const line of crosshairLines(basis, tanH, tanV)) {
      r.reticle.add({
        positions: line.map(toCart),
        width: 1.3,
        material: Cesium.Material.fromType("Color", { color: cyan.withAlpha(0.6) }),
      });
    }

    // ---- dynamic magnitude: a longer lens reveals dimmer stars -----------
    const limit = limitingMagnitude(sensor, focalLengthMm);
    for (let i = 0; i < r.stars.length; i++) {
      const p = r.stars.get(i);
      const sel = p.id as RegaliaSelection;
      if (sel.kind === "star") p.show = sel.star.mag <= limit;
    }

    // ---- camera: zoom the frustum to the framing, lock + hide Earth ------
    const fovH = fovDegrees(sensor.widthMm, focalLengthMm);
    if (frustum instanceof Cesium.PerspectiveFrustum) {
      frustum.fov = Cesium.Math.toRadians(Math.max(1.2, Math.min(80, fovH * 2.0)));
    }
    ctrl.enableInputs = false; // the lock owns the camera; focal slider = zoom
    scene.globe.show = false; // pure sky; camera sits at the sphere's center

    // ---- Frame Analysis: what's inside the reticle right now -------------
    const inStars = r.starList
      .filter((s) => s.mag <= limit && isInFrame(basis, equatorialUnitVec3(s.ra, s.dec), tanH, tanV))
      .sort((a, b) => a.mag - b.mag);
    const inDsos = r.messier
      .filter((m) => isInFrame(basis, equatorialUnitVec3(m.ra, m.dec), tanH, tanV))
      .sort((a, b) => a.mag - b.mag);

    // Primary constellation = most-represented among framed stars (else target).
    const counts: Record<string, number> = {};
    for (const s of inStars) if (s.con) counts[s.con] = (counts[s.con] ?? 0) + 1;
    let constellation = lockTarget.kind === "star" ? lockTarget.star.con ?? "—" : lockTarget.dso.con ?? "—";
    let best = 0;
    for (const k in counts) if (counts[k] > best) ((best = counts[k]), (constellation = k));

    const objects: FrameObject[] = [
      ...inDsos.map((m) => ({ label: `${m.id} · ${m.name}`, sub: m.type, mag: m.mag, kind: "dso" as const })),
      ...inStars.map((s) => ({ label: s.name ?? `HIP ${s.hip}`, sub: s.spect ?? "Star", mag: s.mag, kind: "star" as const })),
    ].slice(0, 8);

    setFrameAnalysis({ constellation, starCount: inStars.length, dsoCount: inDsos.length, limitingMag: limit, objects });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bridge, built, lockTarget, focalLengthMm, sensor]);

  return { status, frameAnalysis };
}
