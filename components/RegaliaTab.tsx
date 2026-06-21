// =============================================================================
// components/RegaliaTab.tsx — "Regalia · Eyes of Stars" mode UI
// =============================================================================
// The planetarium control surface: a layer panel (left) driving the optimized
// Cesium star/constellation/DSO rendering in useRegaliaSky, and an Object
// Inspector card (right) that populates when the user clicks a star or DSO.
// All heavy 3D work lives in the hook; this component is controls + readouts.
// =============================================================================

"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Spline, Type, Orbit, Loader2, X, Star as StarIcon, Camera, Telescope, MapPin } from "lucide-react";
import ToggleSwitch from "@/components/ui/ToggleSwitch";
import { useRegaliaSky, type RegaliaLayers, type RegaliaSelection, type FrameAnalysis } from "@/hooks/useRegaliaSky";
import { useViewerBridge } from "@/lib/viewerBridge";
import { SENSOR_PRESETS, DEFAULT_SENSOR, DEFAULT_FOCAL_LENGTH_MM, fovDegrees } from "@/lib/fovMath";
import { localAltAz } from "@/lib/starCatalog";
import type { Observer } from "@/lib/layers";

/** Live local horizontal coordinates of the inspected object. */
interface LiveAltAz {
  altitude: number;
  azimuth: number;
}

/** Compass point (16-wind) for an azimuth — friendlier than bare degrees. */
function azCompass(azimuthDeg: number): string {
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round((((azimuthDeg % 360) + 360) % 360) / 22.5) % 16];
}

const LAYER_META: {
  key: keyof RegaliaLayers;
  label: string;
  desc: string;
  color: string;
  Icon: typeof Sparkles;
}[] = [
  { key: "stars", label: "Naked-Eye Stars", desc: "Hipparcos catalog, magnitude < 6.0", color: "#2dd4ff", Icon: Sparkles },
  { key: "lines", label: "Constellation Lines", desc: "Stick-figure asterisms", color: "#7c93d8", Icon: Spline },
  { key: "art", label: "Constellation Art", desc: "Figure name labels", color: "#a78bfa", Icon: Type },
  { key: "dso", label: "Deep Sky Objects", desc: "Messier galaxies, nebulae & clusters", color: "#fb7185", Icon: Orbit },
];

export default function RegaliaTab({ active, observer }: { active: boolean; observer: Observer }) {
  const [layers, setLayers] = useState<RegaliaLayers>({
    stars: true,
    lines: true,
    art: false,
    dso: true,
  });
  // Selection doubles as the FOV lock target: clicking an object frames it.
  const [selection, setSelection] = useState<RegaliaSelection | null>(null);
  const [focalLengthMm, setFocalLengthMm] = useState(DEFAULT_FOCAL_LENGTH_MM);
  const [sensorId, setSensorId] = useState(DEFAULT_SENSOR.id);
  const sensor = SENSOR_PRESETS.find((s) => s.id === sensorId) ?? DEFAULT_SENSOR;

  const { status, frameAnalysis } = useRegaliaSky({
    active,
    layers,
    onSelect: setSelection,
    observer,
    lockTarget: selection,
    focalLengthMm,
    sensor,
  });
  const { loading, error, starCount, dsoCount } = status;

  const toggle = (key: keyof RegaliaLayers) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const hFov = fovDegrees(sensor.widthMm, focalLengthMm);
  const vFov = fovDegrees(sensor.heightMm, focalLengthMm);

  // Live local Alt/Az of the inspected object, recomputed each second against
  // the sim clock (Cosmic Time Machine) + observer location.
  const bridge = useViewerBridge();
  const [liveAltAz, setLiveAltAz] = useState<LiveAltAz | null>(null);
  useEffect(() => {
    if (!active || !selection) {
      setLiveAltAz(null);
      return;
    }
    const ra = selection.kind === "star" ? selection.star.ra : selection.dso.ra;
    const dec = selection.kind === "star" ? selection.star.dec : selection.dso.dec;
    const tick = () => {
      const date = bridge
        ? bridge.Cesium.JulianDate.toDate(bridge.viewer.clock.currentTime)
        : new Date();
      setLiveAltAz(localAltAz(ra, dec, observer.latitude, observer.longitude, date));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, selection, observer.latitude, observer.longitude, bridge]);

  if (!active) return null;

  return (
    <>
      {/* ============ centered FOV viewfinder reticle (over the sky) ========= */}
      {/* Frames the centre of the local sky; the camera FOV (driven by the
          focal slider in useRegaliaSky) zooms the sky inside this frame. */}
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
        <div
          className="relative"
          style={{ height: "56vmin", aspectRatio: `${sensor.widthMm} / ${sensor.heightMm}` }}
        >
          <svg
            viewBox="0 0 120 90"
            preserveAspectRatio="none"
            className="h-full w-full text-zenith-cyan"
          >
            {/* frame border */}
            <rect
              x="1" y="1" width="118" height="88"
              fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.85"
              vectorEffect="non-scaling-stroke"
            />
            {/* rule-of-thirds */}
            <g stroke="currentColor" strokeWidth="1" strokeOpacity="0.2" vectorEffect="non-scaling-stroke">
              <line x1="40" y1="1" x2="40" y2="89" />
              <line x1="80" y1="1" x2="80" y2="89" />
              <line x1="1" y1="30" x2="119" y2="30" />
              <line x1="1" y1="60" x2="119" y2="60" />
            </g>
            {/* centre crosshair */}
            <g stroke="currentColor" strokeWidth="1" strokeOpacity="0.6" vectorEffect="non-scaling-stroke">
              <line x1="54" y1="45" x2="66" y2="45" />
              <line x1="60" y1="39" x2="60" y2="51" />
            </g>
          </svg>
          {/* corner brackets */}
          <span className="absolute left-0 top-0 h-4 w-4 border-l-2 border-t-2 border-zenith-cyan" />
          <span className="absolute right-0 top-0 h-4 w-4 border-r-2 border-t-2 border-zenith-cyan" />
          <span className="absolute bottom-0 left-0 h-4 w-4 border-b-2 border-l-2 border-zenith-cyan" />
          <span className="absolute bottom-0 right-0 h-4 w-4 border-b-2 border-r-2 border-zenith-cyan" />
          {/* FOV readout */}
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-panel/80 px-2 py-0.5 font-mono text-[10px] tracking-wider text-zenith-cyan backdrop-blur-sm">
            {hFov.toFixed(1)}° × {vFov.toFixed(1)}° · {focalLengthMm}mm
          </span>
        </div>
      </div>

      {/* ===================== layer control panel (left) ===================== */}
      <motion.aside
        initial={{ opacity: 0, x: -28 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -28 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="glass scrollbar-thin absolute left-2 top-14 z-20 max-h-[42vh] w-56 overflow-y-auto rounded-2xl
                   md:left-4 md:top-4 md:max-h-[calc(100vh-6rem)] md:w-72 md:overflow-hidden"
        aria-label="Regalia sky layers"
      >
        <div className="flex items-center gap-2.5 border-b border-grid px-4 py-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-aurora/10 text-aurora">
            <StarIcon size={18} />
          </span>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-starlight">Regalia</h2>
            <p className="text-[11px] text-stardust">Eyes of Stars · planetarium mode</p>
          </div>
        </div>

        {/* Active observer location — the sky is filtered to this horizon. */}
        <div className="flex items-center gap-2 border-b border-grid bg-void/40 px-4 py-2 font-mono text-[11px]">
          <MapPin size={12} className="shrink-0 text-signal" />
          <span className="text-stardust">
            Viewing from Lat:{" "}
            <span className="text-starlight">{observer.latitude.toFixed(2)}</span>, Lon:{" "}
            <span className="text-starlight">{observer.longitude.toFixed(2)}</span>
          </span>
        </div>

        <ul className="space-y-2 p-3">
          {LAYER_META.map(({ key, label, desc, color, Icon }) => (
            <li
              key={key}
              className="flex items-center gap-3 rounded-lg border border-transparent p-2.5
                         transition-colors hover:bg-panel-raised/60"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md" style={{ color }}>
                <Icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-starlight">{label}</span>
                <span className="block truncate text-[11px] text-faint">{desc}</span>
              </span>
              <ToggleSwitch
                checked={layers[key]}
                color={color}
                label={`${label} layer`}
                onChange={() => toggle(key)}
              />
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-grid px-4 py-2.5 font-mono text-[10px] text-faint">
          {loading ? (
            <span className="flex items-center gap-1.5 text-stardust">
              <Loader2 size={11} className="animate-spin" /> Charting the sky…
            </span>
          ) : error ? (
            <span className="text-alert">Catalog error</span>
          ) : (
            <span>
              <span className="text-zenith-cyan">{starCount}</span> stars ·{" "}
              <span className="text-alert">{dsoCount}</span> DSOs
            </span>
          )}
          <span>Click an object →</span>
        </div>
      </motion.aside>

      {/* ============ object inspector + FOV viewfinder (right) ============ */}
      {/* The viewfinder is ALWAYS available (it controls the local-sky FOV);
          the inspector card slides in above it when an object is selected. */}
      <motion.div
        initial={{ opacity: 0, x: 28 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 28 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="scrollbar-thin absolute inset-x-2 bottom-20 z-20 flex max-h-[46vh] flex-col gap-3
                   overflow-y-auto md:inset-x-auto md:right-4 md:top-4 md:bottom-auto
                   md:max-h-[calc(100vh-6rem)] md:w-80"
      >
        <AnimatePresence>
          {selection && (
            <motion.section
              key={selection.kind === "star" ? `star-${selection.star.hip}` : `dso-${selection.dso.id}`}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              className="glass overflow-hidden rounded-2xl"
              aria-label="Object inspector"
            >
              {selection.kind === "star" ? (
                <StarInspector selection={selection} liveAltAz={liveAltAz} onClose={() => setSelection(null)} />
              ) : (
                <DsoInspector selection={selection} liveAltAz={liveAltAz} onClose={() => setSelection(null)} />
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* — FOV viewfinder: sensor calibration + frame analysis — */}
        <Viewfinder
          sensorId={sensorId}
          setSensorId={setSensorId}
          focalLengthMm={focalLengthMm}
          setFocalLengthMm={setFocalLengthMm}
          hFov={hFov}
          vFov={vFov}
          locked={selection !== null}
          frameAnalysis={frameAnalysis}
        />
      </motion.div>
    </>
  );
}

/* ----------------------------- viewfinder -------------------------------- */

function Viewfinder({
  sensorId,
  setSensorId,
  focalLengthMm,
  setFocalLengthMm,
  hFov,
  vFov,
  locked,
  frameAnalysis,
}: {
  sensorId: string;
  setSensorId: (id: string) => void;
  focalLengthMm: number;
  setFocalLengthMm: (mm: number) => void;
  hFov: number;
  vFov: number;
  locked: boolean;
  frameAnalysis: FrameAnalysis | null;
}) {
  return (
    <section
      className="glass overflow-hidden rounded-2xl"
      aria-label="FOV viewfinder"
    >
      <div className="flex items-center gap-2 border-b border-grid px-4 py-3">
        <Camera size={15} className="text-zenith-cyan" />
        <h3 className="font-mono text-xs font-bold tracking-[0.2em] text-zenith-cyan">VIEWFINDER</h3>
      </div>

      <div className="space-y-4 p-4">
        {/* sensor */}
        <div>
          <label htmlFor="regalia-sensor" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
            Sensor
          </label>
          <select
            id="regalia-sensor"
            value={sensorId}
            onChange={(e) => setSensorId(e.target.value)}
            className="w-full rounded-lg border border-grid bg-void/60 px-2.5 py-2 font-mono text-xs
                       text-starlight focus:border-zenith-cyan/60 focus:outline-none"
          >
            {SENSOR_PRESETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} — {s.widthMm}×{s.heightMm} mm
              </option>
            ))}
          </select>
        </div>

        {/* focal length */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="regalia-focal" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Focal length
            </label>
            <span className="font-mono text-sm font-bold text-zenith-cyan">{focalLengthMm} mm</span>
          </div>
          <input
            id="regalia-focal"
            type="range"
            min={12}
            max={600}
            step={1}
            value={focalLengthMm}
            onChange={(e) => setFocalLengthMm(Number(e.target.value))}
            className="w-full accent-(--color-zenith-cyan)"
            aria-valuetext={`${focalLengthMm} millimeters`}
          />
          <p className="mt-1.5 text-center font-mono text-[11px] text-stardust">
            FRAME <span className="text-aurora">{hFov.toFixed(2)}°</span> ×{" "}
            <span className="text-aurora">{vFov.toFixed(2)}°</span>
          </p>
        </div>

        {/* frame analysis */}
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
            <Telescope size={11} /> Frame Analysis
          </h4>
          {!frameAnalysis ? (
            <p className="rounded-lg border border-grid p-3 font-mono text-[11px] text-faint">
              {locked ? "Analyzing the framed field…" : "Click a star or DSO to analyze its frame."}
            </p>
          ) : (
            <div className="rounded-lg border border-grid bg-void/40 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-faint">Constellation</span>
                <span className="font-mono text-sm font-semibold text-aurora">{frameAnalysis.constellation}</span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-faint">
                {frameAnalysis.starCount} stars · {frameAnalysis.dsoCount} DSOs in frame · limit mag{" "}
                {frameAnalysis.limitingMag.toFixed(1)}
              </p>

              <ul className="mt-2.5 space-y-1.5">
                {frameAnalysis.objects.length === 0 ? (
                  <li className="font-mono text-[11px] text-faint">No catalogued objects in frame.</li>
                ) : (
                  frameAnalysis.objects.map((o, i) => (
                    <li key={`${o.kind}-${o.label}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: o.kind === "dso" ? "#fb7185" : "#2dd4ff" }}
                        />
                        <span className="truncate text-xs text-starlight">{o.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-faint">m{o.mag.toFixed(1)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */

function InspectorHeader({
  badge,
  badgeColor,
  title,
  subtitle,
  onClose,
}: {
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-grid px-4 py-3.5">
      <div className="min-w-0">
        <span
          className="inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: `${badgeColor}22`, color: badgeColor }}
        >
          {badge}
        </span>
        <h3 className="mt-1 truncate text-base font-bold text-starlight">{title}</h3>
        <p className="truncate text-[11px] text-stardust">{subtitle}</p>
      </div>
      <button
        onClick={onClose}
        aria-label="Close inspector"
        className="focus-ring rounded-lg p-1.5 text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">{label}</span>
      <span className="truncate text-right font-mono text-sm text-starlight">{value}</span>
    </div>
  );
}

/** Static RA/Dec + the object's LIVE local Alt/Az (recomputed each second). */
function CoordinatesBlock({
  ra,
  dec,
  liveAltAz,
}: {
  ra: number;
  dec: number;
  liveAltAz: LiveAltAz | null;
}) {
  const above = liveAltAz ? liveAltAz.altitude > 0 : null;
  return (
    <>
      <div className="divide-y divide-grid border-t border-grid">
        <Row label="Right Ascension" value={`${ra.toFixed(2)}°`} />
        <Row label="Declination" value={`${dec >= 0 ? "+" : ""}${dec.toFixed(2)}°`} />
      </div>
      <div className="border-t border-zenith-cyan/25 bg-zenith-cyan/5">
        <div className="flex items-center justify-between px-4 pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zenith-cyan">
            Local Sky · Live
          </span>
          {above !== null && (
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${
                above ? "bg-signal/15 text-signal" : "bg-alert/15 text-alert"
              }`}
            >
              {above ? "ABOVE HORIZON" : "BELOW HORIZON"}
            </span>
          )}
        </div>
        <Row label="Altitude" value={liveAltAz ? `${liveAltAz.altitude.toFixed(1)}°` : "—"} />
        <Row
          label="Azimuth"
          value={liveAltAz ? `${liveAltAz.azimuth.toFixed(1)}° ${azCompass(liveAltAz.azimuth)}` : "—"}
        />
      </div>
    </>
  );
}

function StarInspector({
  selection,
  liveAltAz,
  onClose,
}: {
  selection: Extract<RegaliaSelection, { kind: "star" }>;
  liveAltAz: LiveAltAz | null;
  onClose: () => void;
}) {
  const s = selection.star;
  return (
    <>
      <InspectorHeader
        badge="Star"
        badgeColor="#2dd4ff"
        title={s.name ?? `HIP ${s.hip}`}
        subtitle={s.con ? `Constellation ${s.con}` : "—"}
        onClose={onClose}
      />
      <div className="divide-y divide-grid">
        <Row label="Common Name" value={s.name ?? "—"} />
        <Row label="Hipparcos ID" value={`HIP ${s.hip}`} />
        <Row label="Spectral Type" value={s.spect ?? "—"} />
        <Row label="Distance" value={s.dist != null ? `${s.dist.toLocaleString()} ly` : "—"} />
        <Row label="Visual Magnitude" value={s.mag.toFixed(2)} />
        <Row label="B–V Color Index" value={s.bv.toFixed(2)} />
      </div>
      <CoordinatesBlock ra={s.ra} dec={s.dec} liveAltAz={liveAltAz} />
    </>
  );
}

function DsoInspector({
  selection,
  liveAltAz,
  onClose,
}: {
  selection: Extract<RegaliaSelection, { kind: "dso" }>;
  liveAltAz: LiveAltAz | null;
  onClose: () => void;
}) {
  const m = selection.dso;
  const ly = m.dist >= 1_000_000 ? `${(m.dist / 1_000_000).toFixed(1)}M ly` : `${m.dist.toLocaleString()} ly`;
  return (
    <>
      <InspectorHeader
        badge="Deep Sky Object"
        badgeColor="#fb7185"
        title={`${m.id} · ${m.name}`}
        subtitle={m.type}
        onClose={onClose}
      />
      <div className="divide-y divide-grid">
        <Row label="Catalog ID" value={m.id} />
        <Row label="Type" value={m.type} />
        <Row label="Constellation" value={m.con ?? "—"} />
        <Row label="Distance" value={ly} />
        <Row label="Visual Magnitude" value={m.mag.toFixed(1)} />
      </div>
      <CoordinatesBlock ra={m.ra} dec={m.dec} liveAltAz={liveAltAz} />
    </>
  );
}
