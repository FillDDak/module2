import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    treeshake: true,
  },
  {
    // <script src="https://unpkg.com/gridclip"> exposes window.gridclip
    entry: { 'gridclip.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'gridclip',
    outExtension: () => ({ js: '.js' }),
    minify: true,
    sourcemap: true,
    target: 'es2018',
  },
]);
