/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

declare module "ra-language-german" {
  import type { TranslationMessages } from "ra-core";

  const germanMessages: TranslationMessages;
  export default germanMessages;
}
