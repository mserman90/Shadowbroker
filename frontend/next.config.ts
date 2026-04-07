import type { NextConfig } from "next";

// /api/* requests are proxied to the backend by the catch-all route handler at
// src/app/api/[...path]/route.ts, which reads BACKEND_URL at request time.
// Do NOT add rewrites for /api/* here — next.config is evaluated at build time,
// so any URL baked in here ignores the runtime BACKEND_URL env var.

const nextConfig: NextConfig = {
  transpilePackages: ['react-map-gl', 'mapbox-gl', 'maplibre-gl'],
  // Vercel sets VERCEL=1 automatically → skip standalone (Vercel handles output natively).
  // Docker builds don't set VERCEL → standalone output is used by the Dockerfile.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
};

export default nextConfig;
