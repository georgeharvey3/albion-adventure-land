import { defineConfig } from 'vitest/config';

// Tests run in Node, without the app's Vite plugins. Only the Ethelred server
// has tests today (issue #62).
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
