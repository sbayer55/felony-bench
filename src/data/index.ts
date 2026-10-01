export const REPO_URL = 'https://github.com/sbayer55/felony-bench'
export const ACTIONS_URL = `${REPO_URL}/actions/workflows/refresh.yml`
/** API origin. Empty means same origin (the Vite dev server proxies /api). */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
