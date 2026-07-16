import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Vite otherwise treats `buffer` as an unavailable Node builtin. The
    // Ledger WebHID stack requires the npm browser polyfill installed by
    // nativeFilecoinProvider before its dynamic imports run.
    alias: {
      buffer: 'buffer/'
    }
  },
  css: {
    postcss: './postcss.config.js'
  }
})
