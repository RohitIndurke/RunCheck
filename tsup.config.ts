import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  outDir: 'dist',
  format: ['cjs'],
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Keep .js extension even in CJS mode so the bin path stays stable
  outExtension: () => ({ js: '.js' }),
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  // Bundle everything so `npx runcheck` works without node_modules
  noExternal: [/.*/],
});
