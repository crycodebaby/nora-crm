import { registerSW } from "virtual:pwa-register";

import type { RegisterSwLike } from "./pwaUpdateStore";

/**
 * Einzige Stelle in Nora, die das virtuelle Modul von `vite-plugin-pwa` laedt.
 *
 * Absichtlich isoliert: `virtual:pwa-register` existiert nur im Vite-Build mit
 * aktivem VitePWA-Plugin. Die Update-Logik in `pwaUpdateStore.ts` bleibt dadurch
 * ohne dieses Modul testbar, und der Store haengt nicht am Build-Setup.
 */
export const noraRegisterSW: RegisterSwLike = registerSW;
