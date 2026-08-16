#!/usr/bin/env node
/**
 * Nora CRM – Bundle-Budget
 *
 * Liest die gebauten JS-Chunks aus dist/assets, gibt sie sortiert aus und
 * bricht ab, wenn der Entry-Chunk das Budget ueberschreitet.
 *
 * Zweck: Der Gewinn aus Code-Splitting und Vendor-Chunks soll nicht
 * unbemerkt wieder verloren gehen. Eine Zahl im Log liest niemand nach der
 * ersten Woche — ein roter CI-Job schon.
 *
 * Budget nach der ersten Messung anpassen: `npm run build` ausfuehren, die
 * hier ausgegebene Ist-Groesse ablesen und ENTRY_BUDGET_KB knapp darueber
 * setzen. Dann faengt der Job kuenftige Zuwaechse ab.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Budget fuer den Entry-Chunk in kB (unkomprimiert).
 * Kalibriert am 2026-08-15 auf Basis eines echten Produktions-Builds:
 * gemessener Entry-Chunk 955 kB, ~10% Regression-Headroom.
 */
const ENTRY_BUDGET_KB = 1050;
/**
 * Budget fuer alle JS-Chunks zusammen in kB (unkomprimiert).
 * Kalibriert am 2026-08-15 auf Basis eines echten Produktions-Builds:
 * gemessene Gesamtgroesse 2321 kB, ~12% Regression-Headroom.
 */
const TOTAL_BUDGET_KB = 2600;

const ASSETS_DIR = join(process.cwd(), "dist", "assets");

const kb = (bytes) => Math.round(bytes / 1024);

let files;
try {
  files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`❌ ${ASSETS_DIR} nicht gefunden — wurde "npm run build" ausgefuehrt?`);
  process.exit(1);
}

if (files.length === 0) {
  console.error("❌ Keine JS-Chunks in dist/assets gefunden.");
  process.exit(1);
}

const chunks = files
  .map((name) => ({ name, bytes: statSync(join(ASSETS_DIR, name)).size }))
  .sort((a, b) => b.bytes - a.bytes);

const totalKb = kb(chunks.reduce((sum, c) => sum + c.bytes, 0));

// Vite benennt den Entry-Chunk nach dem Entry-Namen: index-<hash>.js
const entry = chunks.find((c) => /^index-[^/]*\.js$/.test(c.name));

console.log("\nChunk-Groessen (unkomprimiert):");
for (const c of chunks) {
  const marker = c === entry ? " ← Entry" : "";
  console.log(`  ${String(kb(c.bytes)).padStart(6)} kB  ${c.name}${marker}`);
}
console.log(`  ${String(totalKb).padStart(6)} kB  GESAMT (${chunks.length} Chunks)\n`);

const failures = [];

if (!entry) {
  console.warn(
    "⚠️  Kein Chunk nach dem Muster index-<hash>.js gefunden — " +
      "Entry-Budget wird uebersprungen.",
  );
} else if (kb(entry.bytes) > ENTRY_BUDGET_KB) {
  failures.push(
    `Entry-Chunk ${kb(entry.bytes)} kB > Budget ${ENTRY_BUDGET_KB} kB (${entry.name})`,
  );
}

if (totalKb > TOTAL_BUDGET_KB) {
  failures.push(`Gesamt ${totalKb} kB > Budget ${TOTAL_BUDGET_KB} kB`);
}

if (failures.length > 0) {
  console.error("❌ Bundle-Budget ueberschritten:");
  for (const f of failures) console.error(`   - ${f}`);
  console.error(
    "\n   dist/stats.html im CI-Artefakt zeigt, welche Abhaengigkeit gewachsen ist.",
  );
  process.exit(1);
}

console.log("✅ Bundle-Budget eingehalten.");
