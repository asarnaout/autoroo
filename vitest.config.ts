import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { enabled: false },
  },
  resolve: {
    alias: { '@': new URL('./', import.meta.url).pathname },
  },
});
