/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Exposed by electron/preload.cjs when running inside the desktop app.
interface Window {
  desktop?: {
    isDesktop: boolean
    electron: string
  }
}
