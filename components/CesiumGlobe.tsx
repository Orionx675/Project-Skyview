// =============================================================================
// components/CesiumGlobe.tsx — full 3D implementation (CesiumJS), client-only
// =============================================================================
// IMPORT VIA next/dynamic WITH { ssr: false } — Cesium dereferences `window`
// at module-evaluation time and would crash a server render.
//
// How this stays buttery while tracking ~150 objects in real time:
//
//   1. NO REACT RE-RENDERS. This component renders exactly one <div>. It
//      reads the ZenithTracker engine imperatively (tracker.subscribe), so
//      the 1 Hz telemetry tick never reconciles any React tree here.
//
//   2. PER-FRAME PROPAGATION VIA CallbackProperty. Each satellite entity's
//      position is a function of the Cesium clock: every rendered frame,
//      Cesium asks "where is this satellite NOW?" and SGP4 answers
//      (~5-15 µs/object — 150 objects ≈ 1.5 ms/frame, well inside the 16 ms
//      budget). Satellites therefore MOVE CONTINUOUSLY, not in 1 Hz steps.
//
//   3. CATALOG-VERSIONED ENTITY LIFECYCLE. Entities are created/destroyed
//      only when the tracker's catalogVersion changes (layer toggled, TLE
//      re-sync). The 1 Hz tick merely mutates colors/labels in place — and
//      only when an object actually crossed the horizon.
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import type { Entity, Viewer } from "cesium";
import { useTracker } from "@/hooks/useTracker";
import { computeGroundTrack, propagateToDate } from "@/utils/orbitalMath";
import { registerViewerBridge } from "@/lib/viewerBridge";
import type { CatalogEntry } from "@/lib/tracker";
import type { Observer } from "@/lib/layers";
import "cesium/Build/Cesium/Widgets/widgets.css";

type CesiumModule = typeof import("cesium");

interface CesiumGlobeProps {
  observer: Observer;
  /** Currently inspected object — gets a highlight + its full orbit trail. */
  selectedObjectId: string | null;
  /** Camera target-lock: the viewer tracks this entity as it moves (search). */
  trackedObjectId?: string | null;
  /** True while another feature (FOV planner) owns the camera — the lock
   *  releases trackedEntity and stands down until this clears. */
  cameraSuppressed?: boolean;
  /** "Regalia" planetarium mode: hides tracker entities + Cesium sky chrome
   *  and frames the celestial sphere; Regalia owns clicks (star picking). */
  regaliaActive?: boolean;
  onSelectLocation?: (latitude: number, longitude: number) => void;
  /** Fired when the user clicks an object marker on the globe. */
  onInspectObject?: (objectId: string) => void;
}

/** Height of the dashed "zenith beam" above the observer (meters). */
const ZENITH_BEAM_HEIGHT_M = 1_800_000;
/** Solar-system bodies are millions of km away; we plot their SUB-POINT
 *  (the spot on Earth they're directly above) on a symbolic 7,000 km shell. */
const PLANET_SHELL_M = 7_000_000;
/** Re-center the (statically sampled) orbit trail this often while locked. */
const TRAIL_REFRESH_MS = 60_000;
/** Camera pitch used for target-lock framing (degrees below horizontal). */
const TRACK_PITCH_DEG = -25;

/**
 * Stand-off distance for the target-lock camera, scaled to the orbit.
 * CRITICAL: Cesium's default for a tracked POINT entity is its (near-zero)
 * bounding sphere — the camera parks at point-blank range, where extreme
 * near/far depth ratios make the globe and polylines shimmer ("flicker")
 * and the orbit trail is far too close to read. A LEO bird gets ~1,400 km
 * of standoff; GPS at 20,200 km apogee gets proportionally more.
 */
function trackingRangeM(entry: CatalogEntry): number {
  if (entry.kind === "planet") return 5_000_000;
  const apogeeKm = entry.apogeeKm ?? 600;
  return Math.min(Math.max(apogeeKm * 1000 * 0.6, 1_400_000), 12_000_000);
}

/**
 * Default camera offset (entity-local east/north/up frame) matching the
 * fly-in framing: same range, same pitch — so when trackedEntity takes over
 * from the approach flight there is no visible snap.
 */
function viewFromOffset(Cesium: CesiumModule, entry: CatalogEntry) {
  const r = trackingRangeM(entry);
  const pitch = (Math.abs(TRACK_PITCH_DEG) * Math.PI) / 180;
  return new Cesium.Cartesian3(0, -Math.cos(pitch) * r, Math.sin(pitch) * r);
}

/** Public Esri World Imagery MapServer — high-res satellite tiles, no token. */
const ESRI_WORLD_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

/**
 * Build the globe's base imagery layer: photorealistic Esri World Imagery by
 * default (token-free), with the token-free CARTO dark basemap as a fallback
 * so the globe is never blank if Esri fails to initialize. `fromUrl` is async
 * (it fetches the service metadata), hence the Promise.
 */
async function buildBaseImageryLayer(Cesium: CesiumModule) {
  // An optional Esri token suppresses the "default services" advisory and
  // raises rate limits, but is NOT required for the public World_Imagery URL.
  const arcgisToken = process.env.NEXT_PUBLIC_ARCGIS_TOKEN;
  if (arcgisToken) Cesium.ArcGisMapService.defaultAccessToken = arcgisToken;

  try {
    const esri = await Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY, {
      enablePickFeatures: false, // we never query Esri features; saves requests
    });
    return new Cesium.ImageryLayer(esri);
  } catch {
    return new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        credit: new Cesium.Credit("© OpenStreetMap contributors © CARTO"),
        maximumLevel: 18,
      })
    );
  }
}

export default function CesiumGlobe({
  observer,
  selectedObjectId,
  trackedObjectId = null,
  cameraSuppressed = false,
  regaliaActive = false,
  onSelectLocation,
  onInspectObject,
}: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const cesiumRef = useRef<CesiumModule | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const entitiesRef = useRef<Map<string, Entity>>(new Map());
  const observerEntitiesRef = useRef<Entity[]>([]);
  const trailEntityRef = useRef<Entity | null>(null);
  /** When the current trail was sampled — re-centered every TRAIL_REFRESH_MS. */
  const trailBuiltAtRef = useRef(0);
  /** Previous lock target (distinguishes "unlock" from "never locked"). */
  const prevTrackedRef = useRef<string | null>(null);
  /** Catalog version last built into entities — the rebuild gate. */
  const builtVersionRef = useRef(-1);
  /** Last-known horizon state per object — colors mutate only on change. */
  const horizonStateRef = useRef<Map<string, boolean>>(new Map());

  const tracker = useTracker();

  // Latest props readable from Cesium callbacks without re-binding handlers.
  const observerRef = useRef(observer);
  observerRef.current = observer;
  const selectedRef = useRef(selectedObjectId);
  const onSelectRef = useRef(onSelectLocation);
  onSelectRef.current = onSelectLocation;
  const onInspectRef = useRef(onInspectObject);
  onInspectRef.current = onInspectObject;
  const regaliaActiveRef = useRef(regaliaActive);
  regaliaActiveRef.current = regaliaActive;

  // -----------------------------------------------------------------------
  // Entity construction (runs only when catalogVersion changes)
  // -----------------------------------------------------------------------

  function buildEntities() {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;

    const catalog = tracker.getCatalog();
    const liveIds = new Set(catalog.map((e) => e.id));

    // Drop entities whose objects left the catalog. If one of them is the
    // camera's lock target, release the lock first — Cesium would otherwise
    // keep referencing a dead entity.
    for (const [id, entity] of entitiesRef.current) {
      if (!liveIds.has(id)) {
        if (viewer.trackedEntity === entity) viewer.trackedEntity = undefined;
        viewer.entities.remove(entity);
        entitiesRef.current.delete(id);
        horizonStateRef.current.delete(id);
      }
    }

    for (const entry of catalog) {
      if (entitiesRef.current.has(entry.id)) continue;
      const entity =
        entry.kind === "satellite" ? buildSatelliteEntity(Cesium, viewer, entry) : buildPlanetEntity(Cesium, viewer, entry);
      if (entity) entitiesRef.current.set(entry.id, entity);
    }
  }

  function buildSatelliteEntity(Cesium: CesiumModule, viewer: Viewer, entry: CatalogEntry): Entity | null {
    if (!entry.satrec) return null;
    const satrec = entry.satrec;
    const isStation = entry.layerId === "stations";

    // THE real-time core: position as a pure function of the render clock.
    // Cesium calls this every frame; SGP4 propagates to that exact instant.
    // `result` is Cesium's scratch-object idiom — reuse it to avoid per-frame
    // allocations (GC pauses are what stutter actually looks like).
    const positionCallback = new Cesium.CallbackProperty((time, result) => {
      const date = time ? Cesium.JulianDate.toDate(time) : new Date();
      const state = propagateToDate(satrec, date);
      if (!state) return undefined;
      return Cesium.Cartesian3.fromDegrees(
        state.longitude,
        state.latitude,
        state.heightKm * 1000,
        undefined,
        result as never
      );
    }, false /* isConstant: false -> re-evaluate every frame */);

    return viewer.entities.add({
      id: entry.id,
      // CallbackProperty satisfies PositionProperty at runtime; Cesium's TS
      // defs are stricter than its own implementation here.
      position: positionCallback as unknown as import("cesium").PositionProperty,
      // Sensible target-lock standoff (see trackingRangeM) — without this,
      // tracking a point entity parks the camera at point-blank range.
      viewFrom: viewFromOffset(Cesium, entry) as unknown as import("cesium").Property,
      point: {
        pixelSize: isStation ? 9 : 6,
        color: Cesium.Color.fromCssColorString(entry.color).withAlpha(0.35),
        outlineColor: Cesium.Color.fromCssColorString("#04060f").withAlpha(0.9),
        outlineWidth: 1.5,
      },
      label: {
        text: entry.name,
        show: isStation,
        font: "12px 'IBM Plex Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString("#eef2ff"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0a0f1f").withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        pixelOffset: new Cesium.Cartesian2(0, -16),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      },
    });
  }

  function buildPlanetEntity(Cesium: CesiumModule, viewer: Viewer, entry: CatalogEntry): Entity | null {
    // Planets move ~15°/hour across the sky (Earth's rotation) — a 1 Hz
    // position update from the tick is imperceptibly smooth, so no
    // CallbackProperty needed. Position is nudged in applyTick() via
    // setValue() on this ONE persistent property — replacing the property
    // object each tick would jolt a camera that is tracking the entity.
    return viewer.entities.add({
      id: entry.id,
      position: new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(0, 0, PLANET_SHELL_M)
      ),
      viewFrom: viewFromOffset(Cesium, entry) as unknown as import("cesium").Property,
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString(entry.color),
        outlineColor: Cesium.Color.fromCssColorString("#eef2ff").withAlpha(0.8),
        outlineWidth: 2,
      },
      label: {
        text: `◇ ${entry.name.toUpperCase()}`,
        show: true,
        font: "11px 'IBM Plex Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString(entry.color),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0a0f1f").withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        pixelOffset: new Cesium.Cartesian2(0, -14),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Per-tick mutation (1 Hz) — never creates or destroys anything
  // -----------------------------------------------------------------------

  function applyTick() {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;

    const snapshot = tracker.getSnapshot();
    if (snapshot.catalogVersion !== builtVersionRef.current) {
      buildEntities();
      builtVersionRef.current = snapshot.catalogVersion;
    }

    // The orbit trail is a static sample centered on its build time; while a
    // lock is held for minutes it would drift off the satellite. Re-center it
    // quietly once a minute (256 propagations — invisible to the frame rate).
    if (
      trailEntityRef.current &&
      selectedRef.current &&
      Date.now() - trailBuiltAtRef.current > TRAIL_REFRESH_MS
    ) {
      buildTrail(selectedRef.current);
    }

    for (const obj of snapshot.objects) {
      const entity = entitiesRef.current.get(obj.id);
      if (!entity) continue;

      // Planets: 1 Hz sub-point reposition (see buildPlanetEntity note) —
      // mutate the existing property in place, never swap it out.
      if (obj.kind === "planet") {
        const cart = Cesium.Cartesian3.fromDegrees(obj.longitude, obj.latitude, PLANET_SHELL_M);
        if (entity.position instanceof Cesium.ConstantPositionProperty) {
          entity.position.setValue(cart);
        } else {
          entity.position = new Cesium.ConstantPositionProperty(cart);
        }
        continue;
      }

      // Satellites: restyle ONLY when the horizon state actually flipped —
      // above-horizon objects glow at full alpha, the rest dim to 35%.
      const wasAbove = horizonStateRef.current.get(obj.id);
      const isSelected = selectedRef.current === obj.id;
      if (wasAbove !== obj.aboveHorizon) {
        horizonStateRef.current.set(obj.id, obj.aboveHorizon);
        const base = Cesium.Color.fromCssColorString(obj.color);
        if (entity.point) {
          entity.point.color = new Cesium.ConstantProperty(
            obj.aboveHorizon ? base : base.withAlpha(0.35)
          );
        }
        if (entity.label && !isSelected) {
          entity.label.show = new Cesium.ConstantProperty(
            obj.layerId === "stations" || obj.aboveHorizon
          );
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Selection: highlight + one full predicted orbit drawn as a glowing trail
  // -----------------------------------------------------------------------

  function applySelection(previousId: string | null, nextId: string | null) {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;

    // Clear old trail + de-emphasize the previous pick.
    if (trailEntityRef.current) {
      viewer.entities.remove(trailEntityRef.current);
      trailEntityRef.current = null;
    }
    if (previousId) {
      const prev = entitiesRef.current.get(previousId);
      if (prev?.point) prev.point.pixelSize = new Cesium.ConstantProperty(6);
      horizonStateRef.current.delete(previousId); // force a restyle next tick
    }
    if (!nextId) return;

    const entry = tracker.getCatalogEntry(nextId);
    const entity = entitiesRef.current.get(nextId);
    if (!entry || !entity) return;

    if (entity.point) entity.point.pixelSize = new Cesium.ConstantProperty(13);
    if (entity.label) entity.label.show = new Cesium.ConstantProperty(true);

    buildTrail(nextId);
  }

  /**
   * (Re)build the orbit trail for one object: one full period sampled through
   * 3D space, replacing any previous trail. Idempotent and cheap — also used
   * by the once-a-minute freshness refresh in applyTick().
   */
  function buildTrail(objectId: string) {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;

    if (trailEntityRef.current) {
      viewer.entities.remove(trailEntityRef.current);
      trailEntityRef.current = null;
    }

    const entry = tracker.getCatalogEntry(objectId);
    if (!entry || entry.kind !== "satellite" || !entry.satrec || !entry.periodMin) return;

    // Center the orbit trail on the current sim time (scrubbable), not wall-clock.
    const trailCenter = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    const track = computeGroundTrack(entry.satrec, trailCenter, entry.periodMin, 320);
    const positions = track.map((p: { longitude: number; latitude: number; heightKm: number }) =>
      Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.heightKm * 1000)
    );
    trailEntityRef.current = viewer.entities.add({
      polyline: {
        positions,
        width: 3.5,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.18,
          color: Cesium.Color.fromCssColorString(entry.color).withAlpha(0.85),
        }),
      },
    });
    trailBuiltAtRef.current = Date.now();
  }

  // -----------------------------------------------------------------------
  // Observer marker + zenith beam
  // -----------------------------------------------------------------------

  function syncObserver() {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;

    for (const entity of observerEntitiesRef.current) viewer.entities.remove(entity);
    observerEntitiesRef.current = [];

    const { latitude, longitude } = observerRef.current;
    const cyan = Cesium.Color.fromCssColorString("#2dd4ff");
    const green = Cesium.Color.fromCssColorString("#34d399");

    observerEntitiesRef.current.push(
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
        point: { pixelSize: 10, color: green, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          text: "OBSERVER",
          font: "11px 'IBM Plex Mono', monospace",
          fillColor: green,
          pixelOffset: new Cesium.Cartesian2(0, 18),
          verticalOrigin: Cesium.VerticalOrigin.TOP,
        },
      }),
      viewer.entities.add({
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
            Cesium.Cartesian3.fromDegrees(longitude, latitude, ZENITH_BEAM_HEIGHT_M),
          ],
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({ color: cyan.withAlpha(0.7) }),
        },
      })
    );
  }

  function flyToObserver(durationSeconds: number) {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;
    const { latitude, longitude } = observerRef.current;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 18_000_000),
      duration: durationSeconds,
    });
  }

  /**
   * Frame the celestial sphere for Regalia mode: a vantage INSIDE the star
   * dome (camera nearer than the sphere) with Earth floating ahead, so stars
   * surround the view like a planetarium.
   */
  function flyToSky(durationSeconds: number) {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;
    const dest = new Cesium.Cartesian3(0, -7e7, 2.5e7);
    const direction = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.negate(dest, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    viewer.camera.flyTo({
      destination: dest,
      orientation: { direction, up: Cesium.Cartesian3.UNIT_Z },
      duration: durationSeconds,
    });
  }

  // -----------------------------------------------------------------------
  // Viewer lifecycle
  // -----------------------------------------------------------------------

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      // Cesium loads its Workers/Assets/Widgets at runtime from CESIUM_BASE_URL.
      // Those files are copied to /public/cesium by the `copy-cesium` npm script
      // (see package.json) and served at /cesium — so point Cesium there BEFORE
      // importing it. Must run in the browser only; this whole block is gated by
      // next/dynamic({ ssr: false }).
      (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium";

      // Deferred import keeps Cesium's ~3 MB out of the initial page bundle.
      const Cesium = await import("cesium");
      if (disposed || !containerRef.current) return;
      cesiumRef.current = Cesium;

      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

      // Build the photorealistic base layer BEFORE constructing the viewer —
      // ArcGisMapServerImageryProvider.fromUrl is async. Esri World Imagery is
      // free (no token); if it ever fails to initialize we fall back to the
      // token-free CARTO dark basemap so the globe is never blank.
      const baseLayer = await buildBaseImageryLayer(Cesium);
      if (disposed || !containerRef.current) return;

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer,
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        // Round 2 trades the Round-1 requestRenderMode idle-savings for
        // continuous 60 fps rendering: CallbackProperty positions make
        // satellites glide instead of stepping once per second.
        requestRenderMode: false,
      });

      // The render clock IS the propagation clock — keep it on wall time.
      viewer.clock.shouldAnimate = true;
      viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
      viewer.scene.globe.enableLighting = true; // live day/night terminator
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0f1f");

      // 3D terrain (real mountains / depth) via Cesium World Terrain. This is
      // an Ion asset, so it only activates when an Ion token is configured;
      // without one we keep the smooth ellipsoid (still photorealistic via the
      // Esri imagery) rather than spamming 401s. `Cesium.createWorldTerrain()`
      // was the old sync API — removed in Cesium ≥1.104 — so we use the modern
      // `Terrain.fromWorldTerrain()` + `scene.setTerrain()`, which loads async
      // and surfaces failures on errorEvent without blocking startup.
      if (ionToken) {
        const worldTerrain = Cesium.Terrain.fromWorldTerrain();
        worldTerrain.errorEvent.addEventListener(() => {
          /* keep the ellipsoid on failure — globe stays usable */
        });
        viewer.scene.setTerrain(worldTerrain);
        viewer.scene.globe.depthTestAgainstTerrain = true; // markers hug terrain
      }

      // Click routing: an object marker -> inspect; bare globe -> re-anchor
      // the observer ("select any geographic coordinate on Earth").
      viewer.screenSpaceEventHandler.setInputAction(
        (movement: { position: { x: number; y: number } }) => {
          // In Regalia mode the planetarium owns clicks (star/DSO picking).
          if (regaliaActiveRef.current) return;
          const windowPos = new Cesium.Cartesian2(movement.position.x, movement.position.y);
          const picked = viewer.scene.pick(windowPos);
          if (
            Cesium.defined(picked) &&
            picked.id instanceof Cesium.Entity &&
            entitiesRef.current.has(picked.id.id)
          ) {
            onInspectRef.current?.(picked.id.id);
            return;
          }
          const cartesian = viewer.camera.pickEllipsoid(windowPos, viewer.scene.globe.ellipsoid);
          if (!cartesian || !onSelectRef.current) return;
          const carto = Cesium.Cartographic.fromCartesian(cartesian);
          onSelectRef.current(Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude));
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK
      );

      viewerRef.current = viewer;

      // Dev-only QA handle: lets tooling inspect camera/tracking state.
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as Record<string, unknown>).__zenithViewer = viewer;
        (window as unknown as Record<string, unknown>).__Cesium = Cesium;
      }

      // Hand the viewer (and the loaded Cesium module) to sibling features —
      // the FOV planner draws its reticle/trajectory through this bridge.
      registerViewerBridge({ viewer, Cesium });

      // Cosmic Time Machine: the tracker now propagates against the Cesium
      // clock, so scrubbing viewer.clock.currentTime re-plots every satellite
      // and planet at that instant (the globe's points already follow the
      // render clock via CallbackProperty; this keeps telemetry in lock-step).
      tracker.setTimeProvider(() => Cesium.JulianDate.toDate(viewer.clock.currentTime));

      // Imperative bridge to the engine: every tracker tick mutates entities
      // in place. No React involved from here on.
      unsubscribe = tracker.subscribe(applyTick);

      syncObserver();
      applyTick();
      flyToObserver(2.5);
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      registerViewerBridge(null);
      tracker.setTimeProvider(() => new Date()); // back to wall-clock
      entitiesRef.current.clear();
      observerEntitiesRef.current = [];
      trailEntityRef.current = null;
      builtVersionRef.current = -1;
      horizonStateRef.current.clear();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker]);

  // Observer moved (globe click / geolocation): re-draw marker, re-aim camera.
  useEffect(() => {
    syncObserver();
    flyToObserver(1.2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observer.latitude, observer.longitude]);

  // Selection changed: swap highlight + orbit trail.
  useEffect(() => {
    const previous = selectedRef.current;
    selectedRef.current = selectedObjectId;
    applySelection(previous, selectedObjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObjectId]);

  // Target lock, in two beats:
  //   1. APPROACH — viewer.flyTo() glides the camera to a standoff range
  //      scaled to the orbit (engaging trackedEntity directly snaps).
  //   2. ENGAGE — hand the camera to trackedEntity. Its viewFrom matches the
  //      approach framing exactly (same range, same pitch), so the handoff
  //      is seamless; from then on the camera glides with the orbit.
  // A minimum-zoom floor keeps the camera out of point-blank range, where
  // extreme near/far depth ratios shimmer ("flicker"). Unlock releases the
  // floor and returns to the observer.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    const previous = prevTrackedRef.current;
    prevTrackedRef.current = trackedObjectId;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;
    let cancelled = false;

    // Another feature owns the camera (FOV planner viewfinder): release the
    // lock and stand down. When suppression lifts, this effect re-runs and
    // re-engages the orbit lock automatically.
    if (cameraSuppressed) {
      viewer.camera.cancelFlight();
      viewer.trackedEntity = undefined;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1;
      return;
    }

    if (!trackedObjectId) {
      if (previous) {
        viewer.camera.cancelFlight(); // approach may still be mid-flight
        viewer.trackedEntity = undefined;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1;
        flyToObserver(1.5);
      }
      return;
    }

    const entity = entitiesRef.current.get(trackedObjectId);
    const entry = tracker.getCatalogEntry(trackedObjectId);
    if (!entity || !entry) return;

    const rangeM = trackingRangeM(entry);
    viewer.camera.cancelFlight();
    viewer.trackedEntity = undefined; // release any previous lock first

    void viewer
      .flyTo(entity, {
        duration: 1.6,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(TRACK_PITCH_DEG), rangeM),
      })
      .then((finished) => {
        if (cancelled || !finished) return;
        const v = viewerRef.current;
        if (!v || v.isDestroyed()) return;
        v.trackedEntity = entity;
        v.scene.screenSpaceCameraController.minimumZoomDistance = Math.min(rangeM * 0.15, 400_000);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedObjectId, cameraSuppressed]);

  // Regalia (planetarium) mode: hide the tracker's entities and Cesium's own
  // sky chrome so the catalog stars are authoritative, then frame the dome.
  // Reverses cleanly back to the tracker view when it turns off.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;

    // One switch hides every tracker entity (satellites, observer, trail…);
    // the Regalia star primitives live in scene.primitives, so they stay.
    viewer.entities.show = !regaliaActive;
    if (scene.skyBox) scene.skyBox.show = !regaliaActive; // Cesium's stock stars
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = !regaliaActive; // blue glow
    if (scene.sun) scene.sun.show = !regaliaActive; // sun glare would blind stars

    if (regaliaActive) flyToSky(2.2);
    else flyToObserver(1.8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regaliaActive]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      aria-label="3D globe showing live satellite and planet positions"
      role="application"
    />
  );
}
