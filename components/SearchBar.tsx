// =============================================================================
// components/SearchBar.tsx — sky-object search with camera target-lock
// =============================================================================
// Built for people who DON'T know exact designations:
//
//   · Focusing the empty field immediately opens a browsable dropdown of
//     what's overhead right now (closest to the zenith first) — no typing
//     needed to start navigating.
//   · Matching is forgiving: exact prefix > word-start > substring >
//     in-order fuzzy ("zrya" still finds ISS (ZARYA)). Ties break by zenith
//     proximity, so the most relevant sky object wins.
//   · The matched fragment is highlighted in each result, so users see WHY
//     a result appeared.
//
// Selecting a result hands its id to the page, which engages Cesium's
// trackedEntity camera lock — the globe swings to the object and follows it.
// Full keyboard support: "/" focuses from anywhere, arrows navigate, Enter
// locks, Escape dismisses.
// =============================================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useTrackerSnapshot } from "@/hooks/useTracker";
import { DATA_LAYERS, type TrackedObject } from "@/lib/layers";

const LAYER_LABELS = new Map(DATA_LAYERS.map((l) => [l.id, l.label]));
const MAX_RESULTS = 8;

/**
 * Forgiving match score (lower = better), or null for no match:
 *   0 name starts with the query            "iss"  -> "ISS (ZARYA)"
 *   1 a word inside the name starts with it "zar"  -> "ISS (ZARYA)"
 *   2 query appears anywhere                "link" -> "STARLINK-3041"
 *   3 characters appear in order (typo-ish) "zrya" -> "ISS (ZARYA)"
 */
function scoreMatch(name: string, q: string): number | null {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  const idx = n.indexOf(q);
  if (idx > 0) {
    const prev = n[idx - 1];
    return prev === " " || prev === "(" || prev === "-" ? 1 : 2;
  }
  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length ? 3 : null;
}

export default function SearchBar({ onTargetLock }: { onTargetLock: (id: string) => void }) {
  const { objects } = useTrackerSnapshot();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const browsing = q.length === 0; // empty query = "show me what's up there"

  const results = useMemo<TrackedObject[]>(() => {
    // Browse mode: the sky's current highlights — objects nearest the zenith,
    // anything actually overhead first.
    if (browsing) {
      return [...objects]
        .sort((a, b) => {
          if (a.aboveHorizon !== b.aboveHorizon) return a.aboveHorizon ? -1 : 1;
          return a.degreesFromZenith - b.degreesFromZenith;
        })
        .slice(0, MAX_RESULTS);
    }
    // Search mode: forgiving ranked matching.
    return objects
      .map((o) => ({ o, score: scoreMatch(o.name, q) }))
      .filter((r): r is { o: TrackedObject; score: number } => r.score !== null)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.o.degreesFromZenith - b.o.degreesFromZenith;
      })
      .slice(0, MAX_RESULTS)
      .map((r) => r.o);
  }, [objects, q, browsing]);

  // Clamp the keyboard cursor whenever the result set shrinks.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(results.length - 1, 0)));
  }, [results.length]);

  // "/" focuses the search from anywhere (the muscle-memory shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-away closes the dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function choose(obj: TrackedObject) {
    onTargetLock(obj.id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      choose(results[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      {/* ------------------------------------------------------ input ----- */}
      <div
        className="flex items-center gap-2 rounded-lg border border-grid bg-void/60 px-3 py-1.5
                   transition-colors focus-within:border-zenith-cyan/60 focus-within:bg-void/80
                   focus-within:shadow-[0_0_16px_rgba(56,217,255,0.18)]"
      >
        <Search size={14} className="shrink-0 text-faint" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search the sky — ISS, Mars, Starlink…"
          aria-label="Search tracked sky objects"
          role="combobox"
          aria-expanded={open}
          aria-controls="sky-search-results"
          className="w-full bg-transparent font-mono text-xs text-starlight
                     placeholder:text-faint focus:outline-none"
        />
        <kbd className="hidden rounded border border-grid px-1.5 py-0.5 font-mono text-[9px] text-faint lg:inline">
          /
        </kbd>
      </div>

      {/* --------------------------------------------------- dropdown ----- */}
      <AnimatePresence>
        {open && (
          <motion.ul
            id="sky-search-results"
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 480, damping: 34 }}
            className="glass absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl"
          >
            {/* Mode header: tells browsers what they're looking at */}
            <li className="border-b border-grid px-3 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">
              {browsing ? "Suggestions — closest to your zenith" : `Matches for "${query.trim()}"`}
            </li>

            {results.length === 0 ? (
              <li className="px-4 py-3 font-mono text-xs text-faint">
                {browsing
                  ? "No objects tracked yet — enable a data layer."
                  : "No tracked object matches — try fewer letters or enable more layers."}
              </li>
            ) : (
              results.map((obj, i) => (
                <li key={obj.id} role="option" aria-selected={i === activeIndex}>
                  <button
                    onClick={() => choose(obj)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors
                      ${i === activeIndex ? "bg-panel-raised" : ""}`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: obj.color, boxShadow: `0 0 6px ${obj.color}88` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-starlight">
                        <HighlightedName name={obj.name} query={q} />
                      </span>
                      <span className="block text-[10px] uppercase tracking-wider text-faint">
                        {LAYER_LABELS.get(obj.layerId) ?? obj.layerId}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px]">
                      {obj.aboveHorizon ? (
                        <span className="text-signal">{obj.altitude.toFixed(0)}°↑ in sky</span>
                      ) : (
                        <span className="text-faint">below hzn</span>
                      )}
                    </span>
                  </button>
                </li>
              ))
            )}
            <li className="border-t border-grid px-3 py-1.5 text-right font-mono text-[9px] text-faint">
              ↑↓ navigate · ↵ target lock · esc close
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Shows WHY a result matched: the queried fragment lights up cyan. */
function HighlightedName({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>;
  const idx = name.toLowerCase().indexOf(query);
  if (idx === -1) return <>{name}</>; // fuzzy match — no contiguous fragment
  return (
    <>
      {name.slice(0, idx)}
      <span className="text-zenith-cyan">{name.slice(idx, idx + query.length)}</span>
      {name.slice(idx + query.length)}
    </>
  );
}
