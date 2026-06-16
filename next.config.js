// =============================================================================
// next.config.js — Next.js configuration
// =============================================================================
// CesiumJS static assets (Workers / ThirdParty / Assets / Widgets) are copied
// into /public/cesium by the `copy-cesium` npm script (which runs before both
// `dev` and `build` — see package.json) and served at /cesium. The runtime
// base URL is set in components/CesiumGlobe.tsx via
// `window.CESIUM_BASE_URL = "/cesium"` before Cesium is imported.
//
// This pre-build copy replaces the old CopyWebpackPlugin/DefinePlugin webpack
// override, which Vercel's build could fail to execute (-> black screen).
// With no webpack() hook here, Next.js uses its native builders.
// =============================================================================

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode double-invokes effects in dev — CesiumGlobe survives that
  // (it tears the Viewer down correctly), so keep it.
  reactStrictMode: true,
};

module.exports = nextConfig;
