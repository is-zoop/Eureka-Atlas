import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { atlasProxy, localAtlasGuard } from "./local-proxy.ts";

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [localAtlasGuard(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 3889, strictPort: true, open: false, proxy: atlasProxy },
  preview: { host: "127.0.0.1", port: 3889, strictPort: true, open: false, proxy: atlasProxy },
  build: {
    outDir: mode === "desktop" ? "dist-desktop" : "dist",
    target: "es2020",
    rollupOptions: {
      input: {
        ribbon: fileURLToPath(new URL("./index.html", import.meta.url)),
        taskpane: fileURLToPath(new URL("./taskpane.html", import.meta.url)),
        ...(mode === "desktop" ? {} : { publish: fileURLToPath(new URL("./publish.html", import.meta.url)) }),
      },
    },
  },
}));
