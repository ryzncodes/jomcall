import type { NextConfig } from "next";
if (
  process.env.JOMCALL_MODE &&
  !["mock", "local"].includes(process.env.JOMCALL_MODE)
)
  throw new Error("INVALID_MODE");
const nextConfig: NextConfig = {
  distDir:
    process.env.JOMCALL_MODE === "local" ? ".next-local" : ".next-mock",
  logging: {
    incomingRequests: {
      ignore: [/^\/api\/auth\/(confirm|recovery)/, /^\/invite/],
    },
  },
  devIndicators: false,
  images: { qualities: [75, 85] },
};
export default nextConfig;
