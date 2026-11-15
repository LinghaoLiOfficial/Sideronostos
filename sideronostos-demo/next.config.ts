import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_OUTPUT_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    MAPTILER_KEY: process.env.MAPTILER_KEY,
  },
};

export default nextConfig;
