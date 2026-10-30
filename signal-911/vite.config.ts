import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { handle } from './server/ai';

// Serves the local AI dialogue endpoints (/api/ai/*) from the dev and preview servers.
// The Anthropic API key is read on this machine only and never reaches the browser.
const aiPlugin = (): Plugin => ({
  name: 'signal911-ai',
  configureServer(server) { server.middlewares.use((req, res, next) => { void handle(req, res, next); }); },
  configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void handle(req, res, next); }); },
});

export default defineConfig({
  plugins: [react(), aiPlugin()],
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
  build: { chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
