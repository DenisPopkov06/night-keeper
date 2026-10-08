import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@/core": path.resolve(srcDir, "core"),
      "@/systems": path.resolve(srcDir, "systems"),
      "@/sdk": path.resolve(srcDir, "sdk"),
      "@/data": path.resolve(srcDir, "data"),
      "@/ui": path.resolve(srcDir, "ui"),
      "@/render": path.resolve(srcDir, "render"),
      "@/levels": path.resolve(srcDir, "levels"),
      "@": srcDir,
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
