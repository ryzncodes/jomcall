import type { NextConfig } from "next";
if (
  process.env.JOMCALL_MODE &&
  !["mock", "local"].includes(process.env.JOMCALL_MODE)
)
  throw new Error("INVALID_MODE");
const nextConfig: NextConfig = {
  // Vercel expects the default ".next"; locally, keep mock and local builds apart.
  distDir: process.env.VERCEL
    ? ".next"
    : process.env.JOMCALL_MODE === "local"
      ? ".next-local"
      : ".next-mock",
  logging: {
    incomingRequests: {
      ignore: [/^\/api\/auth\/(confirm|recovery)/, /^\/invite/],
    },
  },
  // Build-time mode switch: lets the mock build drop local-only code
  // (voice testing, livekit-client) instead of shipping it unused.
  env: { NEXT_PUBLIC_JOMCALL_MODE: process.env.JOMCALL_MODE ?? "mock" },
  devIndicators: false,
  images: { qualities: [75, 85] },
};
export default nextConfig;
