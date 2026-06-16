// =============================================================================
// next.config.js — CesiumJS + Next.js (App Router) integration
// =============================================================================
// CesiumJS is not a "normal" npm package: at runtime it lazily loads Web
// Workers, WASM, glTF assets, SVG icons and CSS from a *static directory*,
// resolved relative to a global called `CESIUM_BASE_URL`. Webpack cannot see
// those dynamic requests, so we must:
//
//   1. Physically COPY Cesium's static payload (Workers/ThirdParty/Assets/
//      Widgets) into Next's static output directory at build time.
//   2. DEFINE the `CESIUM_BASE_URL` global so Cesium knows where to find them.
//
// SSR note: Cesium touches `window`/`document` at import time, so the Viewer
// must only ever be loaded in the browser. We enforce that in the component
// layer with `next/dynamic(() => import(...), { ssr: false })` — see
// components/CesiumGlobe.tsx. The config below only applies to the client
// bundle (`!isServer`), so the server build never pays Cesium's weight.
//
// Turbopack note: this uses the webpack pipeline. Run `next dev` (no
// --turbopack flag) — the `webpack()` hook is ignored by Turbopack.
// =============================================================================

const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

// Where Cesium's prebuilt static payload lives inside node_modules.
const CESIUM_SOURCE = path.dirname(require.resolve("cesium/package.json"));
const CESIUM_BUILD = path.join(CESIUM_SOURCE, "Build", "Cesium");

// Everything copied below is served by Next at /_next/static/*, so this is
// the public URL prefix Cesium will use to fetch its workers and assets.
const CESIUM_BASE_URL = "/_next/static/cesium";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode double-invokes effects in dev — our CesiumGlobe component is
  // written to survive that (it tears the Viewer down correctly), so keep it.
  reactStrictMode: true,

  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        // (1) Ship Cesium's static runtime payload with the client build.
        new CopyWebpackPlugin({
          patterns: [
            // Web Workers: terrain decoding, geometry tessellation, etc.
            { from: path.join(CESIUM_BUILD, "Workers"), to: "static/cesium/Workers" },
            // WASM + third-party runtime pieces (e.g. draco decoder).
            { from: path.join(CESIUM_BUILD, "ThirdParty"), to: "static/cesium/ThirdParty" },
            // Textures, star maps, approximate terrain heights, IAU data.
            { from: path.join(CESIUM_BUILD, "Assets"), to: "static/cesium/Assets" },
            // Widget CSS + SVG icons for the Viewer chrome.
            { from: path.join(CESIUM_BUILD, "Widgets"), to: "static/cesium/Widgets" },
          ],
        }),

        // (2) Tell Cesium where that payload is served from. Cesium checks
        // for a global `CESIUM_BASE_URL` before falling back to guessing.
        new webpack.DefinePlugin({
          CESIUM_BASE_URL: JSON.stringify(CESIUM_BASE_URL),
        })
      );
    }

    return config;
  },
};

module.exports = nextConfig;
