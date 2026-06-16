// =============================================================================
// components/ObjectModal.tsx — deep-dive dialog for one tracked object
// =============================================================================
// Satellites get: live look angles, derived orbital parameters, the next
// visible passes over the CURRENT observer (real SGP4 horizon scanning, run
// on open — never in the tick loop), raw TLE, and — for the ISS — a live
// cross-check against OpenNotify's independent feed.
// Solar-system bodies get: constellation, magnitude, distance, rise/set.
// =============================================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Modal from "@/components/ui/Modal";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import { useTracker, useTrackedObject } from "@/hooks/useTracker";
import { azimuthToCompass, predictPasses, propagateToDate } from "@/utils/orbitalMath";
import { getBodyDetails } from "@/lib/celestialBodies";
import { DATA_LAYERS } from "@/lib/layers";

interface Pass {
  start: Date;
  end: Date;
  startAzimuth: number;
  endAzimuth: number;
  maxAltitude: number;
  maxAltitudeTime: Date;
  continuous: boolean;
}

interface IssCheck {
  latitude: number;
  longitude: number;
  timestamp: number;
}

const ISS_NORAD_ID = "25544";

export default function ObjectModal({
  objectId,
  lockedId = null,
  onClose,
  onTargetLock,
}: {
  objectId: string | null;
  /** The currently camera-locked object (reflects lock state in the header). */
  lockedId?: string | null;
  onClose: () => void;
  /** Engage the camera target-lock on this object (locks + closes the modal). */
  onTargetLock: (id: string) => void;
}) {
  const isLocked = objectId !== null && objectId === lockedId;
  const tracker = useTracker();
  const live = useTrackedObject(objectId);
  const entry = objectId ? tracker.getCatalogEntry(objectId) : null;
  const layer = entry ? DATA_LAYERS.find((l) => l.id === entry.layerId) : null;

  // ---- pass prediction (satellites): ~2,900 SGP4 calls, deferred off the
  // open-animation frame so the modal springs in at full frame rate. --------
  const [passes, setPasses] = useState<Pass[] | null>(null);
  useEffect(() => {
    setPasses(null);
    if (!entry?.satrec) return;
    const satrec = entry.satrec;
    const timer = setTimeout(() => {
      setPasses(predictPasses(satrec, tracker.getObserver(), { hours: 24, maxPasses: 3 }) as Pass[]);
    }, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId]);

  // ---- planet facts: cheap, compute synchronously on open ------------------
  const bodyDetails = useMemo(() => {
    if (!entry?.body) return null;
    return getBodyDetails(entry.body, tracker.getObserver(), new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId]);

  // ---- ISS cross-check against OpenNotify ----------------------------------
  const [issCheck, setIssCheck] = useState<IssCheck | null>(null);
  useEffect(() => {
    setIssCheck(null);
    if (entry?.noradId !== ISS_NORAD_ID) return;
    let cancelled = false;
    fetch("/api/iss")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => !cancelled && data && !data.error && setIssCheck(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry?.noradId, objectId]);

  // Fair comparison: propagate OUR SGP4 to THEIR timestamp. The ISS covers
  // 7.7 km/s, so comparing "our now" against their (cached) sample would
  // charge honest clock skew as position error.
  const crossCheck = useMemo(() => {
    if (!issCheck || !entry?.satrec) return null;
    const ours = propagateToDate(entry.satrec, new Date(issCheck.timestamp * 1000));
    if (!ours) return null;
    return {
      ourLatitude: ours.latitude as number,
      ourLongitude: ours.longitude as number,
      deltaKm: haversineKm(ours.latitude, ours.longitude, issCheck.latitude, issCheck.longitude),
    };
  }, [issCheck, entry]);

  return (
    <Modal open={objectId !== null} onClose={onClose} labelledBy="object-modal-title">
      {entry && (
        <>
          {/* ----------------------------------------------------- header --- */}
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-grid bg-panel/95 px-5 py-4 backdrop-blur">
            <div className="min-w-0">
              <h2 id="object-modal-title" className="truncate font-mono text-lg font-bold text-starlight">
                {entry.name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: `${entry.color}22`, color: entry.color }}>
                  {layer?.label ?? entry.layerId}
                </span>
                {entry.noradId && <span className="rounded bg-grid px-1.5 py-0.5 text-stardust">NORAD {entry.noradId}</span>}
                {live && (
                  <span className={`rounded px-1.5 py-0.5 ${live.aboveHorizon ? "bg-signal/15 text-signal" : "bg-alert/15 text-alert"}`}>
                    {live.aboveHorizon ? "IN YOUR SKY" : "BELOW HORIZON"}
                  </span>
                )}
                {isLocked && (
                  <span className="rounded bg-zenith-cyan/15 px-1.5 py-0.5 text-zenith-cyan">◉ LOCKED</span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-lg p-1.5 text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
            >
              ✕
            </button>
          </div>

          <div className="space-y-5 p-5">
            {/* ------------------------------------------- lock-on action --- */}
            {/* Click-to-target: lock the camera onto this object and follow it
                across its orbit. Locking closes the modal so the tracked view
                (and its glowing orbit trail) is unobstructed. */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLocked}
              onClick={() => objectId && onTargetLock(objectId)}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5
                font-mono text-xs font-bold uppercase tracking-widest transition-colors
                ${
                  isLocked
                    ? "cursor-default border-zenith-cyan/30 bg-zenith-cyan/5 text-zenith-cyan/70"
                    : "border-zenith-cyan/50 bg-zenith-cyan/10 text-zenith-cyan hover:bg-zenith-cyan/20"
                }`}
            >
              {isLocked ? "◉ Tracking this target" : "◉ Lock on to target"}
            </motion.button>

            {/* ---------------------------------------------- live sky now --- */}
            {live && (
              <section>
                <SectionTitle>Live sky position</SectionTitle>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-grid bg-grid sm:grid-cols-4">
                  <Cell label="ALTITUDE">
                    <AnimatedNumber value={live.altitude} decimals={1} suffix="°" className="text-zenith-cyan" />
                  </Cell>
                  <Cell label="AZIMUTH" sub={azimuthToCompass(live.azimuth)}>
                    <AnimatedNumber value={live.azimuth} decimals={1} suffix="°" className="text-zenith-cyan" />
                  </Cell>
                  <Cell label={entry.kind === "planet" ? "DISTANCE" : "RANGE"}>
                    <AnimatedNumber value={live.rangeKm} grouped suffix=" km" className="text-aurora" />
                  </Cell>
                  <Cell label="FROM ZENITH">
                    <AnimatedNumber value={live.degreesFromZenith} decimals={1} suffix="°" className="text-aurora" />
                  </Cell>
                </div>
              </section>
            )}

            {/* ------------------------------------- satellite: orbit facts --- */}
            {entry.kind === "satellite" && (
              <section>
                <SectionTitle>Orbital parameters · derived from TLE via SGP4</SectionTitle>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-grid bg-grid sm:grid-cols-4">
                  <Cell label="PERIOD">
                    <span className="text-starlight">{entry.periodMin?.toFixed(1)} min</span>
                  </Cell>
                  <Cell label="INCLINATION">
                    <span className="text-starlight">{entry.inclinationDeg?.toFixed(2)}°</span>
                  </Cell>
                  <Cell label="APOGEE">
                    <span className="text-starlight">{Math.round(entry.apogeeKm ?? 0).toLocaleString()} km</span>
                  </Cell>
                  <Cell label="PERIGEE">
                    <span className="text-starlight">{Math.round(entry.perigeeKm ?? 0).toLocaleString()} km</span>
                  </Cell>
                </div>
              </section>
            )}

            {/* -------------------------------------- satellite: next passes --- */}
            {entry.kind === "satellite" && (
              <section>
                <SectionTitle>Next visible passes · your location, 24 h, ≥10° elevation</SectionTitle>
                {passes === null ? (
                  <p className="rounded-lg border border-grid p-3 font-mono text-xs text-faint">
                    SCANNING ORBIT…
                  </p>
                ) : passes.length === 0 ? (
                  <p className="rounded-lg border border-grid p-3 font-mono text-xs text-faint">
                    No passes above 10° in the next 24 hours from your location.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {passes.map((pass, i) => (
                      <motion.li
                        key={pass.start.getTime()}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07 }}
                        className="flex items-center justify-between gap-3 rounded-lg border border-grid bg-void/50 p-3"
                      >
                        <div className="min-w-0 font-mono text-xs">
                          <p className="text-starlight">
                            {pass.continuous ? "Visible continuously" : formatPassWindow(pass)}
                          </p>
                          <p className="mt-0.5 text-faint">
                            {azimuthToCompass(pass.startAzimuth)} → {azimuthToCompass(pass.endAzimuth)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-sm font-bold text-zenith-cyan">
                            {pass.maxAltitude.toFixed(0)}°
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-faint">max alt</p>
                        </div>
                      </motion.li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* ------------------------------------------ planet: ephemeris --- */}
            {entry.kind === "planet" && bodyDetails && (
              <section>
                <SectionTitle>Ephemeris · astronomy-engine, computed locally</SectionTitle>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-grid bg-grid">
                  <Cell label="CONSTELLATION">
                    <span className="text-starlight">{bodyDetails.constellation}</span>
                  </Cell>
                  <Cell label="MAGNITUDE">
                    <span className="text-starlight">
                      {bodyDetails.magnitude !== null ? bodyDetails.magnitude.toFixed(1) : "—"}
                    </span>
                  </Cell>
                  <Cell label="NEXT RISE">
                    <span className="text-starlight">{formatClock(bodyDetails.nextRise)}</span>
                  </Cell>
                  <Cell label="NEXT SET">
                    <span className="text-starlight">{formatClock(bodyDetails.nextSet)}</span>
                  </Cell>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  Distance: {bodyDetails.distanceAu.toFixed(4)} AU. On the globe this body is drawn
                  above its sub-point — the spot on Earth where it is at the zenith right now.
                </p>
              </section>
            )}

            {/* -------------------------------------------- ISS cross-check --- */}
            {entry.noradId === ISS_NORAD_ID && issCheck && crossCheck && (
              <section>
                <SectionTitle>Independent cross-check · OpenNotify</SectionTitle>
                <div
                  className={`rounded-lg border p-3 font-mono text-xs leading-relaxed
                    ${crossCheck.deltaKm < 150 ? "border-signal/30 bg-signal/5" : "border-amber/30 bg-amber/5"}`}
                >
                  <p className="text-stardust">
                    Our SGP4:{" "}
                    <span className="text-starlight">
                      {crossCheck.ourLatitude.toFixed(2)}°, {crossCheck.ourLongitude.toFixed(2)}°
                    </span>
                  </p>
                  <p className="text-stardust">
                    OpenNotify:{" "}
                    <span className="text-starlight">
                      {issCheck.latitude.toFixed(2)}°, {issCheck.longitude.toFixed(2)}°
                    </span>
                  </p>
                  <p className={`mt-1 font-bold ${crossCheck.deltaKm < 150 ? "text-signal" : "text-amber"}`}>
                    Δ {crossCheck.deltaKm < 1 ? "<1" : Math.round(crossCheck.deltaKm)} km, time-matched at
                    their timestamp
                  </p>
                  {crossCheck.deltaKm >= 150 && (
                    <p className="mt-1 text-[10px] text-faint">
                      Residual divergence usually means the other feed propagates from an older
                      element set — ours is freshly synced from CelesTrak.
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* ------------------------------------------------- raw TLE ----- */}
            {entry.line1 && entry.line2 && (
              <section>
                <SectionTitle>Two-line element set · CelesTrak</SectionTitle>
                <pre className="overflow-x-auto rounded-lg border border-grid bg-void/60 p-3 font-mono text-[10px] leading-relaxed text-stardust">
                  {entry.name + "\n" + entry.line1 + "\n" + entry.line2}
                </pre>
              </section>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint">{children}</h3>
  );
}

function Cell({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold">
        {children}
        {sub && <span className="ml-1 text-[10px] text-stardust">{sub}</span>}
      </p>
    </div>
  );
}

function formatPassWindow(pass: Pass): string {
  const sameDay = pass.start.toDateString() === new Date().toDateString();
  const day = sameDay ? "Today" : pass.start.toLocaleDateString(undefined, { weekday: "short" });
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${fmt(pass.start)} – ${fmt(pass.end)}`;
}

function formatClock(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Great-circle distance — used to quantify the OpenNotify agreement. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
