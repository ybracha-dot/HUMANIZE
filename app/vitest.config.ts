import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), '@shared': path.resolve(__dirname, 'shared') } },
  test: { env: { STUDIO_DATA_DIR: path.resolve(__dirname, '.data-test/default') }, include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'], testTimeout: 60000, hookTimeout: 60000, pool: 'forks', fileParallelism: false },
});
