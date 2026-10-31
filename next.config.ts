import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Static shell and prefetch. Request-time routes call connection(). See ADR-0001.
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    // The distro patches pg through Node's require hook. Bundling it skips that hook.
    "@azure/monitor-opentelemetry",
    "@opentelemetry/api",
    "@opentelemetry/api-logs",
  ],
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
