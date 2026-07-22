import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 4000,
    // Fail loudly if 4000 is taken instead of silently hopping to 4001 —
    // a second `npm run dev` used to land on the backend's port and break
    // every API call with CORS-blocked responses.
    strictPort: true,
    allowedHosts: true,
    open: false,
  },
})
