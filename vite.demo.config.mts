import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/tools/demo-cli.ts',
    outDir: '.vite/demo',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: ['better-sqlite3', 'zod'],
      output: { format: 'cjs', entryFileNames: 'demo.cjs' },
    },
  },
});
