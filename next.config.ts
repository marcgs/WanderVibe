import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Static shell and prefetch. Request-time routes call connection(). See ADR-0001.
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
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
