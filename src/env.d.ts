/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for manifest.json and the clips; defaults to `/clips/`. */
  readonly VITE_CLIPS_BASE_URL?: string;
}
