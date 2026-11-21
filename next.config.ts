import type { NextConfig } from "next";

const nextConfig: NextConfig = process.env.CLOSET_TARGET === "vercel"
  ? {
      outputFileTracingIncludes: { "/api/**": ["./public/sample-wardrobe/*.webp"] },
      outputFileTracingExcludes: { "/api/**": ["./Shopee Database/clothes_image_database/**"] },
    }
  : { output: "export", pageExtensions: ["tsx", "jsx", "js"] };

export default nextConfig;
