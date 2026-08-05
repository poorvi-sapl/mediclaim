import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // shadcn-style "@/..." imports. Existing relative imports keep working;
      // this just means pasted shadcn components resolve without rewriting them.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
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
