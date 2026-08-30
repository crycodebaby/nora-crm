import path from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import createHtmlPlugin from "vite-plugin-simple-html";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    visualizer({
      // GitHub Actions setzt CI=true, nicht NODE_ENV=CI — sonst versucht
      // der Visualizer im Headless-Runner einen Browser zu oeffnen.
      open: !process.env.CI,
      filename: "./dist/stats.html",
    }),
    createHtmlPlugin({
      minify: true,
      inject: {
        data: {
          mainScript: `src/main.tsx`,
        },
      },
    }),
    VitePWA({
      // Keep production PWA behavior; E2E should not register a service worker.
      disable: mode === "e2e",
      // "prompt" statt "autoUpdate" (PWA-1B): ein neuer Worker bleibt WAITING,
      // bis der Benutzer bewusst aktualisiert. Mit "autoUpdate" erzwingt der
      // Plugin skipWaiting + clientsClaim — der neue Worker uebernimmt dann
      // sofort offene Tabs und raeumt den Precache des alten Builds weg,
      // waehrend die Seite noch altes JavaScript ausfuehrt. Ein danach erst
      // angeforderter Lazy Chunk des alten Builds existiert weder im Cache
      // noch auf dem Server (404). Siehe docs/nora/17, "PWA-Update-Verhalten
      // nach Deployment", und den Decision-Log-Eintrag zu PWA-1B.
      registerType: "prompt",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
      },
      manifest: false, // Use public/site.webmanifest from index.html
    }),
  ],
  define: {
    "import.meta.env.VITE_NORA_FRONTEND_VERSION": JSON.stringify(
      process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.VITE_NORA_FRONTEND_VERSION ||
        process.env.GITHUB_SHA ||
        "dev",
    ),
    ...(process.env.NODE_ENV === "production" && process.env.VITE_SUPABASE_URL
      ? {
          "import.meta.env.VITE_IS_DEMO": JSON.stringify(
            process.env.VITE_IS_DEMO,
          ),
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
            process.env.VITE_SUPABASE_URL,
          ),
          "import.meta.env.VITE_SB_PUBLISHABLE_KEY": JSON.stringify(
            process.env.VITE_SB_PUBLISHABLE_KEY,
          ),
          "import.meta.env.VITE_INBOUND_EMAIL": JSON.stringify(
            process.env.VITE_INBOUND_EMAIL,
          ),
          "import.meta.env.VITE_ATTACHMENTS_BUCKET": JSON.stringify(
            process.env.VITE_ATTACHMENTS_BUCKET,
          ),
        }
      : {}),
  },
  base: "./",
  esbuild: {
    keepNames: true,
  },
  build: {
    // false: Solange Nora keine private Sourcemap-Uebertragung an ein
    // Error-Monitoring besitzt, duerfen Produktions-Sourcemaps nicht erzeugt
    // werden. "hidden" erzeugt weiterhin .map-Dateien im Deploy-Ordner, die
    // ueber ihre bekannten Pfade abrufbar waeren.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vendor-Trennung: React und ra-core aendern sich selten und bleiben
        // ueber Deploys hinweg im Browser-Cache. Ein Nora-Release invalidiert
        // dann nur noch den Anwendungs-Chunk statt des gesamten Bundles.
        //
        // Funktionsform statt Objektform: eine hier gelistete, aber nicht
        // importierte Abhaengigkeit bricht so nicht den Build.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(
              id,
            )
          )
            return "react";
          if (
            /[\\/]node_modules[\\/](ra-core|ra-supabase-core|ra-i18n-polyglot|@tanstack)[\\/]/.test(
              id,
            )
          )
            return "admin";
          if (/[\\/]node_modules[\\/]@nivo[\\/]/.test(id)) return "charts";
          if (/[\\/]node_modules[\\/](marked|dompurify)[\\/]/.test(id))
            return "markdown";
          if (
            /[\\/]node_modules[\\/](papaparse|jsonexport|react-cropper|cropperjs|react-dropzone)[\\/]/.test(
              id,
            )
          )
            return "transfer";
          if (/[\\/]node_modules[\\/]@hello-pangea[\\/]/.test(id)) return "dnd";
          return undefined;
        },
      },
    },
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
