import "dotenv/config";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://wandervibe:wandervibe@localhost:5432/wandervibe";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      DATABASE_URL: databaseUrl,
    },
  },
});
