import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Uses Node APIs and loads the TypeScript compiler at runtime; keep it out of the bundle.
  serverExternalPackages: ["dependency-cruiser", "typescript"],
  // GitHub profile pictures for the signed-in user.
  // (Object form without `search`: avatar URLs carry a "?v=4" query that a `new URL(...)` pattern rejects.)
  images: { remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com", pathname: "/**" }] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
