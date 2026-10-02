import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // E2E builds to a separate output directory so it never collides with the
  // `.next` that a running `next dev` owns. Unset (the default) keeps `.next`.
  distDir: process.env.NEXT_DIST_DIR,
};

export default nextConfig;
