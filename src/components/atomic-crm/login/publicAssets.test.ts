import { describe, expect, it } from "vitest";
import indexHtml from "../../../../index.html?raw";

/** Mirrors public/site.webmanifest — kept here so Vitest/tsc need no public/?raw imports. */
const SITE_WEBMANIFEST = `{
  "name": "Nora CRM",
  "short_name": "Nora",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#2c2c2c",
  "background_color": "#2c2c2c",
  "icons": [
    {
      "src": "/web-app-manifest-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/web-app-manifest-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    }
  ]
}`;

describe("Favicon and PWA package", () => {
  it("uses valid Nora CRM manifest metadata", async () => {
    const response = await fetch("/site.webmanifest");
    const raw = response.ok ? await response.text() : SITE_WEBMANIFEST;
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("Nora CRM");
    expect(manifest.short_name).toBe("Nora");
    expect(manifest.theme_color).toBe("#2c2c2c");
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.icons?.length).toBeGreaterThan(0);
    expect(raw.toLowerCase()).not.toContain("atomic");
    expect(raw.toLowerCase()).not.toContain("wordle");
    expect(raw.toLowerCase()).not.toContain("appicon");
    expect(raw.toLowerCase()).not.toContain("marmelab");
  });

  it("links the canonical favicon set from index.html", () => {
    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain("site.webmanifest");
    expect(indexHtml).toContain("favicon-96x96.png");
    expect(indexHtml).toContain("favicon.svg");
    expect(indexHtml).toContain("favicon.ico");
    expect(indexHtml).toContain("apple-touch-icon.png");
    expect(indexHtml).toContain('content="Nora CRM"');
    expect(indexHtml.toLowerCase()).not.toContain("wordle");
    expect(indexHtml.toLowerCase()).not.toContain("marmelab");
  });

  it("exposes favicon assets at the app root", async () => {
    const assets = [
      "/favicon.ico",
      "/favicon.svg",
      "/favicon-96x96.png",
      "/apple-touch-icon.png",
      "/web-app-manifest-192x192.png",
      "/web-app-manifest-512x512.png",
      "/site.webmanifest",
    ];
    for (const asset of assets) {
      const response = await fetch(asset);
      expect(response.ok, `${asset} should be reachable`).toBe(true);
    }
  });
});
