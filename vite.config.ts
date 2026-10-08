import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Relative asset paths so the built app also loads from file:// inside Electron.
  base: process.env.ELECTRON ? './' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Personal CRM',
        short_name: 'CRM',
        description: 'Contacts, meeting notes, reminders, and your relationship network.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the app icon for these; on Android each can also be
        // dragged out onto the home screen as its own icon — Capture becomes
        // one tap from unlocking the phone.
        shortcuts: [
          { name: 'Capture', short_name: 'Capture', description: 'Say what happened or what to do', url: '/capture', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Inbox', short_name: 'Inbox', description: 'Review captures', url: '/inbox', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // Puts the CRM in Android's share sheet: share text from the Recorder
        // app (which transcribes on the phone), a note, or a message, and it
        // opens as a capture to check.
        share_target: {
          action: '/capture',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
    }),
  ],
})
