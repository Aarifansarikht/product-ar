import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Camera access (getUserMedia) and device motion require a secure context, so the
// dev server runs over HTTPS (self-signed) and listens on the LAN for testing on real phones.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: { host: true },
  preview: { host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
})
