import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  // Svelte 5 ships separate browser and server builds. Without the browser
  // condition the server build loads and mount() has no DOM to render into.
  resolve: { conditions: ['browser'] },
  test: { environment: 'node' },
})
