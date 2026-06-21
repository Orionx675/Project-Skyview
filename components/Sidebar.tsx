// =============================================================================
// components/Sidebar.tsx — observer controls + animated data-layer toggles
// =============================================================================
// Subscribes to the tracker snapshot for live per-layer counts; the layer
// list enters with a stagger, switches are spring-loaded, and the overhead
// counters pop when they change.
// =============================================================================

"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Crosshair, LocateFixed } from "lucide-react";
import ToggleSwitch from "@/components/ui/ToggleSwitch";
import { useTrackerSnapshot } from "@/hooks/useTracker";
import { DATA_LAYERS, type Observer } from "@/lib/layers";

interface SidebarProps {
  observer: Observer;
  enabledLayerIds: Set<string>;
  onToggleLayer: (layerId: string) => void;
  onUseMyLocation: () => void;
  locating: boolean;
  /** Submit handler for the manual latitude/longitude inputs. */
  onSetCoordinates: (latitude: number, longitude: number) => void;
  /** Present only in the mobile drawer — renders a close button. */
  onClose?: () => void;
  /** When false, the layer-list stagger waits (used to sync with the intro). */
  entranceActive?: boolean;
}

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, x: -18 },
  show: { opacity: 1, x: 0, transition: { type: "spring" as const, stiffness: 320, damping: 28 } },
};

export default function Sidebar({
  observer,
  enabledLayerIds,
  onToggleLayer,
  onUseMyLocation,
  locating,
  onSetCoordinates,
  onClose,
  entranceActive = true,
}: SidebarProps) {
  // 1 Hz re-render — fine for this small subtree, and it keeps the counts live.
  const { loadingLayers, overheadCounts } = useTrackerSnapshot();

  // Manual coordinate entry. Local string state so the user can type freely;
  // re-syncs whenever the observer changes from elsewhere (globe click, GPS).
  const [latInput, setLatInput] = useState(observer.latitude.toFixed(4));
  const [lonInput, setLonInput] = useState(observer.longitude.toFixed(4));
  useEffect(() => {
    setLatInput(observer.latitude.toFixed(4));
    setLonInput(observer.longitude.toFixed(4));
  }, [observer.latitude, observer.longitude]);

  const lat = Number(latInput);
  const lon = Number(lonInput);
  const valid =
    latInput.trim() !== "" &&
    lonInput.trim() !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;

  const submitCoordinates = (e: React.FormEvent) => {
    e.preventDefault();
    if (valid) onSetCoordinates(lat, lon);
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-grid bg-panel/85 backdrop-blur-xl">
      {/* ------------------------------------------------ observer block --- */}
      <section className="border-b border-grid p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stardust">
            Observer Position
          </h2>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="focus-ring rounded p-1 text-stardust transition-colors hover:bg-panel-raised hover:text-starlight"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Editable lat/lon — type coordinates and submit to fly there. */}
        <form onSubmit={submitCoordinates} className="rounded-lg border border-grid bg-void/60 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] text-faint">LAT °</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.0001"
                min={-90}
                max={90}
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                aria-label="Latitude in degrees"
                className="w-full rounded border border-grid bg-panel px-2 py-1.5 font-mono text-sm
                           text-zenith-cyan focus:border-zenith-cyan/60 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] text-faint">LON °</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.0001"
                min={-180}
                max={180}
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                aria-label="Longitude in degrees"
                className="w-full rounded border border-grid bg-panel px-2 py-1.5 font-mono text-sm
                           text-zenith-cyan focus:border-zenith-cyan/60 focus:outline-none"
              />
            </label>
          </div>

          <motion.button
            type="submit"
            whileHover={{ scale: valid ? 1.015 : 1 }}
            whileTap={{ scale: valid ? 0.97 : 1 }}
            disabled={!valid}
            className="focus-ring mt-2.5 flex w-full items-center justify-center gap-1.5 rounded border
                       border-zenith-cyan/40 bg-zenith-cyan/10 px-3 py-1.5 font-mono text-[11px] font-semibold
                       uppercase tracking-wider text-zenith-cyan transition-colors hover:bg-zenith-cyan/20
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Crosshair size={13} /> Go to coordinates
          </motion.button>

          {!valid && (
            <p className="mt-1.5 font-mono text-[10px] text-alert">
              Lat −90…90, Lon −180…180.
            </p>
          )}
          {observer.label && valid && (
            <p className="mt-2 truncate text-xs text-stardust">{observer.label}</p>
          )}
        </form>

        <motion.button
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.97 }}
          onClick={onUseMyLocation}
          disabled={locating}
          className="focus-ring mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-grid
                     bg-panel-raised/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-stardust
                     transition-colors hover:bg-panel-raised hover:text-starlight disabled:cursor-wait disabled:opacity-50"
        >
          <LocateFixed size={13} /> {locating ? "Acquiring fix…" : "Use my location"}
        </motion.button>

        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Type coordinates above, click the globe, or use your location — then
          travel through time below.
        </p>
      </section>

      {/* --------------------------------------------------- layer block --- */}
      <section className="scrollbar-thin flex-1 overflow-y-auto p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-stardust">
          Data Layers
        </h2>

        <motion.ul
          variants={listVariants}
          initial="hidden"
          animate={entranceActive ? "show" : "hidden"}
          className="space-y-2"
        >
          {DATA_LAYERS.map((layer) => {
            const enabled = enabledLayerIds.has(layer.id);
            const loading = loadingLayers.has(layer.id);
            const overhead = overheadCounts.get(layer.id) ?? 0;

            return (
              <motion.li key={layer.id} variants={itemVariants}>
                <div
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 transition-colors duration-300
                    ${enabled ? "border-grid bg-panel-raised" : "border-transparent hover:bg-panel-raised/50"}`}
                >
                  {/* Accent dot — pulses while the layer's TLEs are loading */}
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${loading ? "pulse-live" : ""}`}
                    style={{
                      backgroundColor: enabled ? layer.color : "transparent",
                      boxShadow: enabled ? `0 0 8px ${layer.color}66` : "none",
                      border: `1.5px solid ${layer.color}`,
                    }}
                  />

                  {/* Row body doubles as a big toggle target */}
                  <button
                    onClick={() => onToggleLayer(layer.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    aria-label={`Toggle ${layer.label}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-starlight">
                      {layer.label}
                      {/* Overhead counter pops in/out as objects cross the horizon */}
                      <AnimatePresence mode="popLayout">
                        {enabled && overhead > 0 && (
                          <motion.span
                            key={overhead} // re-pop on every count change
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.6 }}
                            transition={{ type: "spring", stiffness: 500, damping: 28 }}
                            className="rounded bg-signal/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-signal"
                          >
                            {overhead}↑
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-faint">
                      {layer.description}
                    </span>
                  </button>

                  <ToggleSwitch
                    checked={enabled}
                    color={layer.color}
                    label={`${layer.label} layer`}
                    onChange={() => onToggleLayer(layer.id)}
                  />
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      </section>
    </aside>
  );
}
