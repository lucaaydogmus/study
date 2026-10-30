import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
