/** Base URL of the backend; empty = same origin (the Docker and production setup). */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3000'
