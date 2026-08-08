import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built assets resolve correctly whether this is served from a domain
  // root (Cloudflare Pages) or a subpath (GitHub Pages project sites, e.g. /androweb/).
  base: './',
  plugins: [react(), tailwindcss()],
})
