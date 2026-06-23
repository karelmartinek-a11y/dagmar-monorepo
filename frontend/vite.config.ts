import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// DAGMAR frontend build is served by Nginx at https://dagmar.hcasc.cz/
// Runtime API is available at https://dagmar.hcasc.cz/api/
// Dev server proxy keeps local development convenient.
export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: isDev
        ? {
            "/api": {
              target: "http://127.0.0.1:8101",
              changeOrigin: false,
              secure: false,
            },
          }
        : undefined,
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      emptyOutDir: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  };
});
