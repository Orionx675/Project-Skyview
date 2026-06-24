// =============================================================================
// next.config.js — Next.js configuration
// =============================================================================
// CesiumJS is loaded at runtime from a CDN inside components/CesiumGlobe.tsx
// (window.CESIUM_BASE_URL points at the same CDN), so there is no webpack
// asset-copy step and no custom webpack() hook here — Next.js uses its native
// builders. React Strict Mode is left on: CesiumGlobe tears its Viewer down
// correctly, so the dev double-invoke of effects is harmless.
// =============================================================================

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
