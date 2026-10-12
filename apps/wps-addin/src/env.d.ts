import type { WpsApplication } from "./lib/host.ts";

declare global {
  interface Window {
    Application?: WpsApplication;
    AtlasOnLoad: () => boolean;
    AtlasOpenPane: () => boolean;
    AtlasAbout: () => boolean;
    AtlasUpdateAll: () => boolean;
    AtlasGetOverwrite: () => boolean;
    AtlasSetOverwrite: () => boolean;
    AtlasGetImage: (control: { Id: string }) => string;
  }
}
