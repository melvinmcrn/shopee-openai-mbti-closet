import type { NextConfig } from "next";

const nextConfig: NextConfig = process.env.CLOSET_TARGET === "vercel"
  ? { outputFileTracingIncludes: { "/api/**": ["./public/sample-wardrobe/*.webp"] } }
  : { output: "export", pageExtensions: ["tsx", "jsx", "js"] };

export default nextConfig;
