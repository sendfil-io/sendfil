import process from 'node:process';
import { defineConfig } from 'vitest/config';

const isFutureTestLane = process.env.VITEST_TEST_LANE === 'future';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    include: [
      isFutureTestLane
        ? 'src/**/*.future.{test,spec}.{ts,tsx}'
        : 'src/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: isFutureTestLane
      ? []
      : ['src/**/*.future.{test,spec}.{ts,tsx}'],
  },
});
