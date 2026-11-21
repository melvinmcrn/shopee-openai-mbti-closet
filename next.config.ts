import type { NextConfig } from "next";

const vercel = process.env.MBTI_TARGET === "vercel";
const nextConfig: NextConfig = {
  // The Sites Worker serves the export. Vercel runs the App Router API.
  ...(vercel ? {} : { output: "export", pageExtensions: ["tsx", "jsx", "js"] }),
};

export default nextConfig;
