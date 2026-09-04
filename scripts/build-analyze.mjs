#!/usr/bin/env node
/**
 * Nora CRM – Produktions-Build mit Bundle-Analyse (PERF-01A)
 *
 * Fuehrt exakt `vite build` aus (gleicher Mode, gleiche .env-Dateien, gleiche
 * Chunks) und setzt nur NORA_BUNDLE_ANALYZE=1, damit vite.config.ts den
 * Visualizer nach bundle-analysis/stats.html schreibt. Existiert als Skript,
 * weil `VAR=1 vite build` unter Windows-Shells nicht funktioniert und das
 * Repository kein cross-env mitbringt. Weitere Argumente werden an Vite
 * durchgereicht.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// "vite/bin/vite.js" liegt nicht in Vites "exports"-Map; ueber package.json
// aufloesen, das exportiert ist.
const viteBin = join(
  dirname(require.resolve("vite/package.json")),
  "bin",
  "vite.js",
);

const result = spawnSync(
  process.execPath,
  [viteBin, "build", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, NORA_BUNDLE_ANALYZE: "1" },
  },
);

process.exit(result.status ?? 1);
