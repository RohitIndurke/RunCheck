import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  // Bundle everything so `npx runcheck` works without node_modules
  noExternal: [/.*/],
});
