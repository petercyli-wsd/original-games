/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the ratings API, e.g. https://originals-api.onrender.com. Unset hides ratings. */
  readonly VITE_RATINGS_API_URL?: string;
  /** "true" lists template games in production. */
  readonly VITE_SHOW_TEMPLATES?: string;
}
