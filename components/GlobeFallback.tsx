// =============================================================================
// components/GlobeFallback.tsx — loading state while the Cesium chunk streams
// =============================================================================
// A pure-CSS radar sweep so the "cosmic radar" identity lands before the 3D
// engine boots. Shared by both the desktop and mobile globe loaders.
// =============================================================================

export default function GlobeFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-void">
      <div className="relative h-32 w-32">
        <div className="absolute inset-0 rounded-full border border-grid" />
        <div className="absolute inset-4 rounded-full border border-grid" />
        <div className="absolute inset-8 rounded-full border border-grid" />
        <div
          className="absolute inset-0 animate-spin rounded-full"
          style={{
            animationDuration: "2.4s",
            background:
              "conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgb(45 212 255 / 0.35) 360deg)",
          }}
        />
        <div className="glow-cyan absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zenith-cyan" />
      </div>
      <p className="font-mono text-xs tracking-[0.3em] text-stardust">INITIALIZING ORBITAL VIEW</p>
    </div>
  );
}
