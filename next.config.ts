import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sites accepts static exports in `out/`; keep the app deployable without a
  // Next.js server runtime.
  output: "export",
};

export default nextConfig;
