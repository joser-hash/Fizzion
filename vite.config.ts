import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the app under /Fizzion/; dev stays at the root so
  // local tooling (and the Playwright suites) keep hitting localhost:5173/.
  base: command === 'build' ? '/Fizzion/' : '/',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
  },
}));
