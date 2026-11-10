import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/{unit,integration,recovery}/**/*.test.ts'],
    // Integration fixtures use real memory-hard password hashing. Keep their
    // CPU/memory contention bounded as additional file-backed suites are added.
    maxWorkers: 2,
  },
});
