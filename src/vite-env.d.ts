/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Felony Bench API. Empty or unset means same origin. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
